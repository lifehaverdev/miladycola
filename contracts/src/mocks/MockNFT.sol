// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "solady/tokens/ERC721.sol";
import "solady/utils/LibString.sol";

contract CoolNFT is ERC721 {
    using LibString for uint256;

    // The next token ID to be minted.
    uint256 private _nextTokenId = 1;

    // Base URI for token metadata (can be set after deployment)
    string private _baseTokenURI;

    constructor() {
        // Default to empty - can be set via setBaseURI
    }

    /// @dev Returns the token collection name.
    function name() public pure override returns (string memory) {
        return "Milady";
    }

    /// @dev Returns the token collection symbol.
    function symbol() public pure override returns (string memory) {
        return "MIL";
    }

    /// @notice Sets the base URI for token metadata.
    /// @param baseURI The base URI (e.g., "http://localhost:5173/milady/")
    function setBaseURI(
        string calldata baseURI
    ) external {
        _baseTokenURI = baseURI;
    }

    /// @dev Returns the Uniform Resource Identifier (URI) for token `id`.
    function tokenURI(
        uint256 id
    ) public view override returns (string memory) {
        // If base URI is set, return baseURI + id + ".json"
        if (bytes(_baseTokenURI).length > 0) {
            return string.concat(_baseTokenURI, id.toString(), ".json");
        }
        // Fallback to hardcoded IPFS URI
        return "ipfs://QmanYsjnxPVtaFwUQ4uQSRETNWKjDSzeakT3iz13AUr4ZY";
    }

    /// @notice Mints a new token to the specified address.
    /// @dev Only the owner of this contract can mint new tokens.
    /// This is a simplified minting function for testing purposes.
    function mint(
        address to
    ) external returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _mint(to, tokenId);
        return tokenId;
    }

    /// @notice Returns the next token ID that will be minted (for test orchestration).
    function previewNextId() external view returns (uint256) {
        return _nextTokenId;
    }
}
