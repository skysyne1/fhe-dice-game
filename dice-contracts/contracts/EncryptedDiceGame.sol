// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, euint8, ebool, externalEuint32, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @dev Custom errors for gas optimization and better UX
error OnlyOwner();
error InvalidDiceCount();
error InvalidStakeAmount();
error GameNotFound();
error GameAlreadyResolved();
error InsufficientBalance();
error ZeroAddress();
error MaxMintExceeded();
error NoETHSent();
error OnlyGamePlayer();

/// @title Encrypted Dice Game Contract
/// @notice A dice rolling game with FHE encryption for privacy
/// @dev This contract uses FHEVM v0.9.1 for fully homomorphic encryption
/// @author Zama Community Contributors
contract EncryptedDiceGame is ZamaEthereumConfig {
    // Game constants
    uint256 public constant PAYOUT_MULTIPLIER = 195; // 1.95x payout
    uint256 public constant BASIS_POINTS = 100;
    uint256 public constant MIN_STAKE = 1 ether; // 1 ROLL minimum
    uint256 public constant MAX_STAKE = 1000 ether; // 1000 ROLL maximum
    uint256 public constant ROLL_TOKEN_RATE = 1000; // 1 ETH = 1000 ROLL
    uint256 public constant MAX_MINT = 10000 ether; // 10000 ROLL max mint

    // State variables
    address public owner;
    uint256 public gameCounter;

    // Encrypted balances (using euint32 for ROLL without decimals)
    mapping(address => euint32) public playerBalance;

    // Game struct
    struct Game {
        address player;
        uint8 diceCount;
        euint8 prediction; // 0 for even, 1 for odd (encrypted)
        euint32 stakeAmount; // encrypted (ROLL without decimals)
        euint32[] diceValues; // encrypted dice results
        uint256 timestamp;
        bool isResolved;
    }

    // Game storage
    mapping(uint256 => Game) public games;

    // Player games tracking
    mapping(address => uint256[]) public playerGames;

    // Events
    event GameStarted(uint256 indexed gameId, address indexed player, uint8 diceCount, uint256 timestamp);
    event GameResolved(uint256 indexed gameId, address indexed player, uint256 timestamp);
    event TokensSwapped(address indexed user, uint256 ethAmount, uint256 rollAmount, bool ethToRoll);
    event TokensMinted(address indexed user, uint256 amount);
    event TreasuryFunded(address indexed funder, uint256 amount);

    // Modifiers
    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier validDiceCount(uint8 diceCount) {
        if (diceCount < 1 || diceCount > 3) revert InvalidDiceCount();
        _;
    }

    /// @notice Initialize the contract
    constructor() {
        owner = msg.sender;
        gameCounter = 0;
    }

    /// @notice Mint ROLL tokens for testing
    /// @param amount Amount of ROLL tokens to mint (in ROLL units without decimals)
    function mintTokens(uint256 amount) external {
        if (amount > MAX_MINT) revert MaxMintExceeded();

        euint32 encryptedAmount = FHE.asEuint32(uint32(amount));
        playerBalance[msg.sender] = FHE.add(playerBalance[msg.sender], encryptedAmount);

        // Set permissions
        FHE.allowThis(playerBalance[msg.sender]);
        FHE.allow(playerBalance[msg.sender], msg.sender);

        emit TokensMinted(msg.sender, amount);
    }

    /// @notice Swap ETH for ROLL tokens
    /// @dev 1 ETH = 1000 ROLL (ROLL has no decimals, 1 ROLL = 1 unit)
    /// msg.value is in wei (1 ETH = 1e18 wei)
    /// ROLL amount = (msg.value / 1e18) * 1000 = ROLL units without decimals
    function swapETHForROLL() external payable {
        if (msg.value == 0) revert NoETHSent();

        // Calculate ROLL amount: normalize msg.value to ETH units, then multiply by rate
        // msg.value (wei) / 1e18 = ETH amount, ETH * 1000 = ROLL units
        uint256 rollAmount = (msg.value * ROLL_TOKEN_RATE) / 1 ether;
        
        // Ensure rollAmount fits in uint32
        require(rollAmount <= type(uint32).max, "ROLL amount too large for uint32");
        
        euint32 encryptedAmount = FHE.asEuint32(uint32(rollAmount));

        playerBalance[msg.sender] = FHE.add(playerBalance[msg.sender], encryptedAmount);

        // Set permissions
        FHE.allowThis(playerBalance[msg.sender]);
        FHE.allow(playerBalance[msg.sender], msg.sender);

        emit TokensSwapped(msg.sender, msg.value, rollAmount, true);
    }

    /// @notice Swap ROLL tokens for ETH
    /// @param rollAmount ROLL amount to swap (in ROLL units, no decimals)
    /// @param encryptedAmount Encrypted ROLL amount to swap
    /// @param amountProof Proof for the encrypted amount
    function swapROLLForETH(uint32 rollAmount, externalEuint32 encryptedAmount, bytes calldata amountProof) external {
        require(rollAmount > 0, "Amount must be greater than 0");
        
        // Calculate ETH amount: rollAmount / ROLL_TOKEN_RATE
        uint256 ethAmount = (uint256(rollAmount) * 1 ether) / ROLL_TOKEN_RATE;
        
        // Check contract has enough ETH
        require(address(this).balance >= ethAmount, "Insufficient contract ETH balance");
        
        euint32 encRollAmount = FHE.fromExternal(encryptedAmount, amountProof);

        // Deduct from balance
        playerBalance[msg.sender] = FHE.sub(playerBalance[msg.sender], encRollAmount);

        // Set permissions
        FHE.allowThis(playerBalance[msg.sender]);
        FHE.allow(playerBalance[msg.sender], msg.sender);

        // Send calculated ETH amount to user
        payable(msg.sender).transfer(ethAmount);

        emit TokensSwapped(msg.sender, ethAmount, rollAmount, false);
    }

    /// @notice Add ETH to contract treasury (only owner)
    /// @dev This function allows the owner to fund the contract for ROLL→ETH swaps
    function addTreasuryETH() external payable onlyOwner {
        require(msg.value > 0, "Must send ETH");
        emit TreasuryFunded(msg.sender, msg.value);
    }

    /// @notice Get contract ETH balance
    /// @return Contract's ETH balance in wei
    function getContractETHBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Start a new dice game
    /// @param diceCount Number of dice to roll (1-3)
    /// @param encryptedPrediction Encrypted prediction (0=even, 1=odd)
    /// @param predictionProof Proof for prediction
    /// @param encryptedStake Encrypted stake amount
    /// @param stakeProof Proof for stake amount
    function startGame(
        uint8 diceCount,
        externalEuint8 encryptedPrediction,
        bytes calldata predictionProof,
        externalEuint32 encryptedStake,
        bytes calldata stakeProof
    ) external validDiceCount(diceCount) {
        euint8 prediction = FHE.fromExternal(encryptedPrediction, predictionProof);
        euint32 stakeAmount = FHE.fromExternal(encryptedStake, stakeProof);

        // Create new game
        uint256 gameId = gameCounter++;
        Game storage game = games[gameId];
        game.player = msg.sender;
        game.diceCount = diceCount;
        game.prediction = prediction;
        game.stakeAmount = stakeAmount;
        game.timestamp = block.timestamp;
        game.isResolved = false;

        // Initialize dice values array
        game.diceValues = new euint32[](diceCount);

        // Deduct stake from balance (Note: In production, need balance validation)
        playerBalance[msg.sender] = FHE.sub(playerBalance[msg.sender], stakeAmount);

        // Track this game for the player
        playerGames[msg.sender].push(gameId);

        // Set permissions
        FHE.allowThis(playerBalance[msg.sender]);
        FHE.allow(playerBalance[msg.sender], msg.sender);
        FHE.allowThis(game.prediction);
        FHE.allow(game.prediction, msg.sender);
        FHE.allowThis(game.stakeAmount);
        FHE.allow(game.stakeAmount, msg.sender);

        emit GameStarted(gameId, msg.sender, diceCount, block.timestamp);
    }

    /// @notice Resolve a dice game
    /// @param gameId The game ID to resolve
    function resolveGame(uint256 gameId) external {
        Game storage game = games[gameId];
        if (game.player != msg.sender) revert OnlyGamePlayer();
        if (game.isResolved) revert GameAlreadyResolved();

        // Generate random dice values
        euint32 sum = FHE.asEuint32(0);

        for (uint8 i = 0; i < game.diceCount; ++i) {
            // Simple pseudo-random generation
            uint32 randomValue = uint32(
                uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, gameId, i))) % 6
            ) + 1;

            game.diceValues[i] = FHE.asEuint32(randomValue);
            sum = FHE.add(sum, FHE.asEuint32(randomValue));

            // Set permissions
            FHE.allowThis(game.diceValues[i]);
            FHE.allow(game.diceValues[i], msg.sender);
        }

        // Check if sum is even or odd using bitwise AND with 1
        euint32 leastBit = FHE.and(sum, FHE.asEuint32(1));
        ebool isEven = FHE.eq(leastBit, FHE.asEuint32(0));

        // Check if player predicted correctly
        ebool predictedEven = FHE.eq(game.prediction, FHE.asEuint8(0));
        ebool won = FHE.eq(isEven, predictedEven);

        // Calculate payout - simplified approach
        // For demo: just return double the stake if won, nothing if lost
        euint32 doublePayout = FHE.add(game.stakeAmount, game.stakeAmount);
        euint32 finalPayout = FHE.select(won, doublePayout, FHE.asEuint32(0));
        playerBalance[msg.sender] = FHE.add(playerBalance[msg.sender], finalPayout);

        // Set permissions
        FHE.allowThis(playerBalance[msg.sender]);
        FHE.allow(playerBalance[msg.sender], msg.sender);
        FHE.allowThis(won);
        FHE.allow(won, msg.sender);

        game.isResolved = true;

        emit GameResolved(gameId, msg.sender, block.timestamp);
    }

    /// @notice Get game details
    /// @param gameId the game ID
    /// @return player The player address
    /// @return diceCount Number of dice rolled
    /// @return timestamp Game creation timestamp
    /// @return isResolved Whether game is resolved
    function getGame(
        uint256 gameId
    ) external view returns (address player, uint8 diceCount, uint256 timestamp, bool isResolved) {
        Game storage game = games[gameId];
        return (game.player, game.diceCount, game.timestamp, game.isResolved);
    }

    /// @notice Get player's encrypted balance
    /// @param player Player address
    /// @return Encrypted balance
    function getBalance(address player) external view returns (euint32) {
        return playerBalance[player];
    }

    /// @notice Get encrypted prediction for a game (only by player)
    /// @param gameId Game ID
    /// @return Encrypted prediction
    function getGamePrediction(uint256 gameId) external view returns (euint8) {
        if (games[gameId].player != msg.sender) revert OnlyGamePlayer();
        return games[gameId].prediction;
    }

    /// @notice Get encrypted stake amount for a game (only by player)
    /// @param gameId Game ID
    /// @return Encrypted stake amount
    function getGameStake(uint256 gameId) external view returns (euint32) {
        if (games[gameId].player != msg.sender) revert OnlyGamePlayer();
        return games[gameId].stakeAmount;
    }

    /// @notice Get encrypted dice values for a game (only by player)
    /// @param gameId Game ID
    /// @return Array of encrypted dice values
    function getGameDiceValues(uint256 gameId) external view returns (euint32[] memory) {
        if (games[gameId].player != msg.sender) revert OnlyGamePlayer();
        return games[gameId].diceValues;
    }

    /// @notice Get all game IDs for a player
    /// @param player Player address
    /// @return Array of game IDs
    function getPlayerGames(address player) external view returns (uint256[] memory) {
        return playerGames[player];
    }

    /// @notice Get player's game count
    /// @param player Player address  
    /// @return Number of games played by player
    function getPlayerGameCount(address player) external view returns (uint256) {
        return playerGames[player].length;
    }

    /// @notice Make a player's balance publicly decryptable
    /// @param player The player whose balance should be made public
    function makeBalancePubliclyDecryptable(address player) external {
        // Only the player themselves or the owner can make balance public
        require(msg.sender == player || msg.sender == owner, "Unauthorized");
        
        FHE.makePubliclyDecryptable(playerBalance[player]);
    }

    /// @notice Get a player's encrypted balance (for public decryption)
    /// @param player The player's address
    /// @return The encrypted balance
    function getPlayerBalance(address player) external view returns (euint32) {
        return playerBalance[player];
    }

    /// @notice Withdraw ETH (owner only)
    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    /// @notice Receive ETH
    receive() external payable {}

    /// @notice Fallback function
    fallback() external payable {}
}
