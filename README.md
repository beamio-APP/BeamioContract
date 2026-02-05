# BeamioContract

[![Solidity](https://img.shields.io/badge/Solidity-0.8.33-blue.svg)](https://soliditylang.org/)
[![Hardhat](https://img.shields.io/badge/Hardhat-3.1.6-yellow.svg)](https://hardhat.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Smart contracts for Beamio ecosystem, featuring Account Abstraction (ERC-4337) support and comprehensive deployment tooling for Base network.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Contract Verification](#contract-verification)
- [Project Structure](#project-structure)
- [Development](#development)
- [Security](#security)
- [License](#license)

## 🎯 Overview

BeamioContract is a collection of smart contracts implementing Account Abstraction (ERC-4337) functionality on Base network. The project includes:

- **BeamioAccount**: ERC-4337 compatible smart contract wallet with multi-signature support
- **BeamioUserCard**: ERC-1155 based user card system with redeem functionality
- **Deployment Tools**: Automated deployment and verification scripts for Base network

## ✨ Features

### Account Abstraction (ERC-4337)
- ✅ ERC-4337 EntryPoint V0.7 compatible
- ✅ Multi-signature wallet support
- ✅ Gas abstraction via Paymaster
- ✅ Batch transactions
- ✅ Social recovery mechanisms

### User Card System
- ✅ ERC-1155 token standard
- ✅ Redeem functionality with password-based access
- ✅ Faucet pool support
- ✅ Container-based asset management

### Deployment & Verification
- ✅ Automated deployment scripts
- ✅ CREATE2 deployment support for predictable addresses
- ✅ Automatic contract verification on BaseScan
- ✅ Multi-network support (Base Mainnet & Sepolia)

## 🏗️ Architecture

### Core Contracts

#### BeamioAccount
ERC-4337 compatible smart contract wallet that supports:
- Multi-signature operations
- Threshold-based policy management
- EntryPoint integration for gas abstraction
- Container module for asset management

#### BeamioAccountDeployer
CREATE2-based deployer for predictable account addresses:
- Factory-controlled deployment
- Salt-based address computation
- Batch account creation support

#### BeamioUserCard
ERC-1155 implementation for user card system:
- Currency management
- Oracle integration for pricing
- Quote helper for conversions
- Redeem module for access control

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd BeamioContract
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` and configure:
```env
# Base Network RPC URLs
BASE_RPC_URL=https://mainnet.base.org
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Deployer Account
PRIVATE_KEY=your_private_key_here

# BaseScan API Key (for automatic verification)
BASESCAN_API_KEY=your_basescan_api_key_here
```

### Compile Contracts

```bash
npm run compile
```

## 📦 Deployment

### Standard Deployment

Deploy BeamioAccount directly:

```bash
# Base Mainnet
npm run deploy:base

# Base Sepolia Testnet
npm run deploy:base-sepolia
```

### CREATE2 Deployment (Predictable Addresses)

For batch deployments with predictable addresses:

1. Deploy BeamioAccountDeployer:
```bash
npm run deploy:deployer:base
```

2. Set Factory address (if needed):
```typescript
await deployerContract.setFactory(factoryAddress);
```

3. Deploy AA accounts via deployer:
```bash
# Set in .env:
# DEPLOYER_ADDRESS=0x...
# FACTORY_ADDRESS=0x... (optional)
# CREATOR_ADDRESS=0x... (optional, defaults to deployer)
# ACCOUNT_INDEX=0

npm run deploy:aa:base
```

### Deployment Scripts

| Script | Description | Network |
|--------|-------------|---------|
| `deployBeamioAccount.ts` | Standard deployment | `--network base` |
| `deployBeamioAccountDeployer.ts` | Deploy CREATE2 deployer | `--network base` |
| `deployAAAccountViaDeployer.ts` | Deploy via deployer | `--network base` |

## ✅ Contract Verification

All deployment scripts include **automatic contract verification** on BaseScan.

### Features

- ✅ Automatic verification after deployment
- ✅ Smart retry with block confirmation wait
- ✅ CREATE2 deployment support
- ✅ Friendly error handling
- ✅ BaseScan link generation

### Manual Verification

If automatic verification fails, verify manually:

```bash
npx hardhat verify --network base <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

Example:
```bash
npx hardhat verify --network base 0x1234... 0x0000000071727De22E5E9d8BAf0edAc6f37da032
```

## 📁 Project Structure

```
BeamioContract/
├── src/
│   ├── BeamioAccount/          # Account Abstraction contracts
│   │   ├── BeamioAccount.sol
│   │   ├── BeamioAccountDeployer.sol
│   │   ├── BeamioContainerModuleV07.sol
│   │   ├── BeamioFactoryPaymasterV07.sol
│   │   └── BeamioTypesV07.sol
│   ├── BeamioUserCard/         # User Card system contracts
│   │   ├── BeamioUserCard.sol
│   │   ├── BeamioERC1155Logic.sol
│   │   ├── BeamioOracle.sol
│   │   └── ...
│   └── contracts/              # Shared utilities
│       ├── token/              # ERC20, ERC721, ERC1155
│       ├── utils/              # Utility libraries
│       └── ...
├── scripts/
│   ├── deployBeamioAccount.ts
│   ├── deployBeamioAccountDeployer.ts
│   ├── deployAAAccountViaDeployer.ts
│   └── utils/
│       └── verifyContract.ts   # Verification utilities
├── deployments/                # Deployment records (auto-generated)
├── artifacts/                  # Compilation artifacts (auto-generated)
├── hardhat.config.ts          # Hardhat configuration
└── package.json
```

## 🔧 Development

### Available Scripts

```bash
# Compile contracts
npm run compile

# Clean artifacts and cache
npm run clean

# Deploy to Base Mainnet
npm run deploy:base

# Deploy to Base Sepolia
npm run deploy:base-sepolia

# Deploy deployer contract
npm run deploy:deployer:base

# Deploy AA account via deployer
npm run deploy:aa:base

# Verify contract manually
npm run verify
```

### Testing

```bash
npm test
```

### Code Quality

The project uses:
- Solidity 0.8.33
- Hardhat 3.1.6
- TypeScript for deployment scripts
- ESLint (if configured)

## 🔒 Security

### Important Security Notes

1. **Private Keys**: Never commit `.env` files to version control
2. **Deployment Accounts**: Use dedicated accounts for deployment, not main wallets
3. **Multi-sig**: Consider using multi-signature wallets for critical operations
4. **Audits**: Contracts should be audited before mainnet deployment

### EntryPoint Address

The project uses the standard ERC-4337 EntryPoint V0.7 address:
```
0x0000000071727De22E5E9d8BAf0edAc6f37da032
```

This address is consistent across all chains.

## 📚 Documentation

- [Deployment Guide](./DEPLOY.md) - Detailed deployment instructions
- [Deployment & Verification Guide](./README_DEPLOYMENT.md) - Complete deployment and verification guide

## 🌐 Network Information

### Base Mainnet
- Chain ID: `8453`
- RPC URL: `https://mainnet.base.org`
- Explorer: [BaseScan](https://basescan.org/)

### Base Sepolia (Testnet)
- Chain ID: `84532`
- RPC URL: `https://sepolia.base.org`
- Explorer: [BaseScan Sepolia](https://sepolia.basescan.org/)

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- [Base Documentation](https://docs.base.org/)
- [BaseScan Explorer](https://basescan.org/)
- [ERC-4337 Specification](https://eips.ethereum.org/EIPS/eip-4337)
- [Hardhat Documentation](https://hardhat.org/docs)

## ⚠️ Disclaimer

This software is provided "as is" without warranty of any kind. Use at your own risk. Always audit smart contracts before deploying to mainnet.

---

Made with ❤️ for the Base ecosystem
