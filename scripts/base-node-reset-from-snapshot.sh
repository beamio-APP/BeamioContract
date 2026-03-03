#!/bin/bash
# Base 节点：停止 op-reth/op-node，清除工作目录，拉取官方最新快照（边拉边解压），
# 解冻到工作目录后启动 P2P sync 方式的 op-reth 和 op-node
#
# 用法：在 Base 节点服务器上执行
#   scp scripts/base-node-reset-from-snapshot.sh user@server:/home/peter/
#   ssh user@server 'cd /home/peter/base && bash /home/peter/base-node-reset-from-snapshot.sh'
#
# 或直接 SSH 进服务器后：
#   cd /home/peter/base && bash base-node-reset-from-snapshot.sh

set -e

WORK_DIR="${WORK_DIR:-/home/peter/base}"

# 确保存在 docker-compose 配置
if ! ls "$WORK_DIR"/docker-compose*.yml 1>/dev/null 2>&1; then
    echo "错误: $WORK_DIR 下未找到 docker-compose*.yml"
    exit 1
fi
SNAPSHOT_TYPE="${SNAPSHOT_TYPE:-archive}"  # archive | pruned
NETWORK="${NETWORK:-mainnet}"              # mainnet | sepolia

echo "=== Base 节点快照重置脚本 ==="
echo "工作目录: $WORK_DIR"
echo "快照类型: $SNAPSHOT_TYPE"
echo "网络: $NETWORK"
echo ""

# 检测 docker-compose 文件
COMPOSE_OPT=""
for f in docker-compose-op-reth-home.yml docker-compose.yml; do
    if [ -f "$WORK_DIR/$f" ]; then
        COMPOSE_OPT="-f $f"
        echo "使用: $f"
        break
    fi
done

# 1. 停止 op-reth 和 op-node
echo ">>> 1. 停止 op-reth 和 op-node ..."
cd "$WORK_DIR"
if docker compose $COMPOSE_OPT ps 2>/dev/null | grep -qE "Up|running"; then
    docker compose $COMPOSE_FILE down
    echo "   已停止 docker compose 服务"
else
    # 尝试按容器名停止（兼容旧部署）
    for c in base-op-reth base-op-geth base-op-node base-execution base-node; do
        if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^${c}$"; then
            docker stop "$c" 2>/dev/null || true
            docker rm "$c" 2>/dev/null || true
            echo "   已停止容器: $c"
        fi
    done
fi
echo ""

# 2. 删除所有现有链数据（不保留，全部删除，必要时用 sudo）
# 注意：op-reth 会被删除，脚本会在步骤 4 重新创建并填充数据
# snapshots 目录保留：内含 wget 断点续传的未完成文件，重新执行可续传
echo ">>> 2. 删除所有现有链数据 ..."
for d in reth-data geth-data op-reth snapshot-extract chaindata nodes segments reth; do
    if [ -e "$WORK_DIR/$d" ]; then
        if rm -rf "$WORK_DIR/$d" 2>/dev/null; then
            echo "   已删除 $WORK_DIR/$d"
        else
            echo "   使用 sudo 删除 $WORK_DIR/$d ..."
            sudo rm -rf "$WORK_DIR/$d"
            echo "   已删除 $WORK_DIR/$d"
        fi
    fi
done
echo ""

# 3. 确定快照 URL 并拉取（边拉边解压）
echo ">>> 3. 拉取官方最新快照（边拉边解压）..."

case "$NETWORK" in
    mainnet)
        BASE_URL="https://mainnet-reth-${SNAPSHOT_TYPE}-snapshots.base.org"
        ;;
    sepolia)
        BASE_URL="https://sepolia-reth-${SNAPSHOT_TYPE}-snapshots.base.org"
        ;;
    *)
        echo "错误: 未知网络 $NETWORK"
        exit 1
        ;;
esac

LATEST=$(curl -sL "${BASE_URL}/latest" | tr -d '\n\r')
if [ -z "$LATEST" ]; then
    echo "错误: 无法获取 latest 快照文件名"
    exit 1
fi
SNAPSHOT_URL="${BASE_URL}/${LATEST}"
echo "   快照: $SNAPSHOT_URL"

# 数据目录：docker-compose-op-reth-home 挂载 op-reth，否则用 reth-data
DATA_DIR="$WORK_DIR/reth-data"
[ -f "$WORK_DIR/docker-compose-op-reth-home.yml" ] && DATA_DIR="$WORK_DIR/op-reth"
mkdir -p "$DATA_DIR"
EXTRACT_DIR="$WORK_DIR/snapshot-extract"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"

# STREAM_MODE=1：边拉边解压（省磁盘，但中断后无法续传）
# STREAM_MODE=0（默认）：先 wget -c 下载（支持断点续传），再解压
STREAM_MODE="${STREAM_MODE:-0}"
SNAPSHOT_FILE="$WORK_DIR/snapshots/${LATEST}"

if [ "$STREAM_MODE" = "1" ]; then
    echo "   模式: 流式下载+解压（不支持断点续传）"
    if [[ "$LATEST" == *".zst" ]]; then
        curl -sL "$SNAPSHOT_URL" | tar -I zstd -xvf - -C "$EXTRACT_DIR"
    else
        curl -sL "$SNAPSHOT_URL" | tar -xzvf - -C "$EXTRACT_DIR"
    fi
else
    echo "   模式: wget 断点续传下载，完成后解压"
    mkdir -p "$WORK_DIR/snapshots"
    if ! wget -c -O "$SNAPSHOT_FILE" "$SNAPSHOT_URL"; then
        echo "错误: wget 下载失败（可重新执行脚本从断点续传）"
        exit 1
    fi
    echo "   下载完成，开始解压..."
    if [[ "$LATEST" == *".zst" ]]; then
        tar -I zstd -xvf "$SNAPSHOT_FILE" -C "$EXTRACT_DIR"
    else
        tar -xzvf "$SNAPSHOT_FILE" -C "$EXTRACT_DIR"
    fi
    echo "   解压完成，可删除快照文件释放空间: rm -f $SNAPSHOT_FILE"
fi
echo ""

# 4. 将解压内容移动到 reth-data（兼容多种快照结构）
echo ">>> 4. 移动数据到 reth-data ..."
DATA_SRC=""
if [ -d "$EXTRACT_DIR/reth" ]; then
    DATA_SRC="$EXTRACT_DIR/reth"
elif [ -d "$EXTRACT_DIR/geth" ]; then
    DATA_SRC="$EXTRACT_DIR/geth"
elif [ -d "$EXTRACT_DIR/snapshots/mainnet/download" ]; then
    DATA_SRC="$EXTRACT_DIR/snapshots/mainnet/download"
elif [ -d "$EXTRACT_DIR/chaindata" ] || [ -d "$EXTRACT_DIR/nodes" ]; then
    DATA_SRC="$EXTRACT_DIR"
else
    DATA_SRC="$EXTRACT_DIR"
fi
if [ -n "$DATA_SRC" ] && [ -d "$DATA_SRC" ]; then
    cp -a "$DATA_SRC"/* "$DATA_DIR/" 2>/dev/null || mv "$DATA_SRC"/* "$DATA_DIR/"
fi
rm -rf "$EXTRACT_DIR"
echo "   数据已就绪: $DATA_DIR"
ls -la "$DATA_DIR/" | head -20
echo ""

# 5. 启动 op-reth 和 op-node（P2P sync）
echo ">>> 5. 启动 op-reth 和 op-node（P2P sync）..."
cd "$WORK_DIR"
export CLIENT=reth
export HOST_DATA_DIR="$DATA_DIR"
export NETWORK_ENV="${NETWORK_ENV:-.env.mainnet}"
[ "$NETWORK" = "sepolia" ] && export NETWORK_ENV=".env.sepolia"

docker compose $COMPOSE_OPT up -d --build
echo ""
echo "=== 启动完成 ==="
echo "查看日志: docker compose logs -f"
echo "RPC 端口: 8545"
echo "P2P 端口: 30303 (execution), 9222 (op-node)"
echo ""
echo "注意: 请确保 .env.mainnet 中已配置 L1 端点:"
echo "  OP_NODE_L1_ETH_RPC=   (以太坊 L1 RPC)"
echo "  OP_NODE_L1_BEACON=    (L1 Beacon API)"
echo "  OP_NODE_L1_BEACON_ARCHIVER="
echo ""
