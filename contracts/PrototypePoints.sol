// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Fixed-supply token for the disposable local token demonstration.
contract PrototypePoints is ERC20 {
    error LocalChainOnly();

    constructor(address recipient) ERC20("ArtGuard Test Points", "AGP") {
        if (block.chainid != 31337) revert LocalChainOnly();
        _mint(recipient, 100 ether);
    }
}
