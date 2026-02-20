/**
 * 通过 Blockscout flattened-code API 验证 BeamioIndexerDiamond
 * 解决 Hardhat verify 的 413 请求过大问题
 *
 * 前置: npx hardhat flatten src/CoNETIndexTaskdiamond/BeamioIndexerDiamond.sol 2>/dev/null > scripts/BeamioIndexerDiamond_flat.sol
 * 运行: npx tsx scripts/verifyCoNETViaBlockscoutAPI.ts
 */

import { ethers } from "ethers"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DIAMOND = "0x0DBDF27E71f9c89353bC5e4dC27c9C5dAe0cc612"
const API = "https://mainnet.conet.network/api/v2"
const INITIAL_OWNER = "0x87cAeD4e51C36a2C2ece3Aaf4ddaC9693d2405E1"
const DIAMOND_CUT_FACET = "0xf079eA83B3dDBaB64473df13Fa49021BA85E80C4"

async function main() {
	const flatPath = path.join(__dirname, "BeamioIndexerDiamond_flat.sol")
	let sourceCode = fs.readFileSync(flatPath, "utf-8")
	// 移除 hardhat flatten 可能混入的 dotenv 等非源码行
	sourceCode = sourceCode.replace(/^\[dotenv[^\n]*\n/, "")
	if (!sourceCode.includes("contract BeamioIndexerDiamond")) {
		throw new Error("Flattened file invalid - run: npx hardhat flatten src/CoNETIndexTaskdiamond/BeamioIndexerDiamond.sol > scripts/BeamioIndexerDiamond_flat.sol")
	}

	const coder = ethers.AbiCoder.defaultAbiCoder()
	const encoded = coder.encode(["address", "address"], [INITIAL_OWNER, DIAMOND_CUT_FACET])
	const constructorArgsHex = encoded.startsWith("0x") ? encoded.slice(2) : encoded

	// viaIR: true 与 hardhat.config 一致，否则 bytecode 不匹配
	const body: Record<string, unknown> = {
		compiler_version: "v0.8.33+commit.64118f21",
		license_type: "mit",
		source_code: sourceCode,
		is_optimization_enabled: true,
		optimization_runs: 50,
		contract_name: "BeamioIndexerDiamond",
		constructor_arguments: constructorArgsHex,
		autodetect_constructor_args: false,
		evm_version: "osaka", // 与 hardhat 编译一致 (0.8.33 默认)
	}
	// Blockscout 可能支持的 via-IR 参数（不保证所有实例支持）
	if (process.env.VIA_IR !== "0") {
		;(body as any).via_ir = true
	}

	const url = `${API}/smart-contracts/${DIAMOND}/verification/via/flattened-code`
	console.log("POST", url)
	console.log("Body keys:", Object.keys(body))
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})
	const data = await res.json().catch(() => ({}))
	if (!res.ok) {
		console.error("Verification failed:", res.status, JSON.stringify(data, null, 2))
		throw new Error(JSON.stringify(data))
	}
	console.log("Verification result:", data)
	// 验证可能异步，检查是否有 error
	const err = (data as any)?.error || (data as any)?.message
	if (typeof err === "string" && err.toLowerCase().includes("fail")) {
		console.warn("⚠️ 验证可能失败，请检查浏览器:", "https://mainnet.conet.network/address/" + DIAMOND)
	} else {
		console.log("\n✅ 验证已提交！查看: https://mainnet.conet.network/address/" + DIAMOND)
	}
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
