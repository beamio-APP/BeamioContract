// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {LibDiamond} from "../libraries/LibDiamond.sol";
import {LibAdminStorage} from "../libraries/LibAdminStorage.sol";

contract AdminFacet {
    event AdminSet(address indexed admin, bool enabled);

    function setAdmin(address admin, bool enabled) external {
        LibDiamond.enforceIsContractOwner();
        LibAdminStorage.layout().isAdmin[admin] = enabled;
        emit AdminSet(admin, enabled);
    }

    function isAdmin(address admin) external view returns (bool) {
        return LibAdminStorage.layout().isAdmin[admin];
    }
}
