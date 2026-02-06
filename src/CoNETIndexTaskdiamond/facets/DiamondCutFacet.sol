// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IDiamondCut} from "../interfaces/IDiamondCut.sol";
import {LibDiamond} from "../libraries/LibDiamond.sol";
import {LibAdminStorage} from "../libraries/LibAdminStorage.sol";

contract DiamondCutFacet is IDiamondCut {
    function _enforceIsOwnerOrAdmin() internal view {
        if (msg.sender == LibDiamond.contractOwner()) return;
        require(LibAdminStorage.layout().isAdmin[msg.sender], "not admin");
    }
    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external override {
         _enforceIsOwnerOrAdmin();
        LibDiamond.diamondCut(_diamondCut, _init, _calldata);
    }
}
