#!/bin/bash
# Base 节点快照部署 / 同步进度检测
# 用法：在本地执行 ssh peter@38.102.126.30 'bash -s' < scripts/base-node-check-progress.sh
# 或 SSH 进服务器后：bash base-node-check-progress.sh

echo "=== 1. 部署脚本进度（若在运行）==="
if [ -f /home/peter/base-snapshot-deploy.log ]; then
    tail -30 /home/peter/base-snapshot-deploy.log
else
    echo "  未找到部署日志"
fi

echo ""
echo "=== 2. 部署进程状态 ==="
pgrep -af "base-node-reset-from-snapshot" 2>/dev/null || echo "  部署脚本未在运行（可能已完成或未启动）"

echo ""
echo "=== 3. 网络下载/解压进度（若在拉取快照）==="
if pgrep -x curl >/dev/null; then
    echo "  curl 正在运行（下载中）"
    ls -lh /home/peter/base/reth-data 2>/dev/null | head -5 || true
elif pgrep -x tar >/dev/null; then
    echo "  tar 正在运行（解压中）"
fi

echo ""
echo "=== 4. 链数据目录大小（op-reth / reth-data）==="
du -sh /home/peter/base/op-reth 2>/dev/null || echo "  op-reth 不存在或为空"
du -sh /home/peter/base/reth-data 2>/dev/null || true

echo ""
echo "=== 5. Docker 容器状态 ==="
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "op-reth|op-node|execution|node|base" || docker ps -a 2>/dev/null | head -10

echo ""
echo "=== 6. RPC 状态（若节点已启动，端口 8547）==="
curl -s -m 3 http://127.0.0.1:8547 -H "content-type:application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_syncing","params":[]}' 2>/dev/null | jq -r '.result // .error.message' || echo "  RPC 不可达"
curl -s -m 3 http://127.0.0.1:8547 -H "content-type:application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' 2>/dev/null | jq -r 'if .result then "当前区块: " + .result else empty end'

echo ""
echo "=== 7. 磁盘使用 ==="
df -h /home/peter/base 2>/dev/null || df -h /
#ssh peter@38.102.126.30 'bash -s' < /home/peter/base/base-node-check-progress.sh