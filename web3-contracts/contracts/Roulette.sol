// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Roulette is ReentrancyGuard, Ownable {
    IERC20 public immutable token; // APTC Token (immutable after deployment)
    uint256 public minBet;
    address public constant TREASURY = 0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199;
    uint256 public constant TREASURY_FEE_RATE = 5; // 0.5% = 5 / 1000
    uint256 public constant MIN_WAIT_BLOCK = 1;

    uint256 public nonce;
    uint256 public lastBetBlock;
    uint256 public randomResult;
    uint256 public currentRound;

    enum BetType {
        Number, Color, OddEven, HighLow, Dozen, Column,
        Split, Street, Corner, Line
    }

    struct Bet {
        address player;
        uint256 amount;
        BetType betType;
        uint8 betValue;
        uint256[] numbers;
        uint256 round;
    }

    Bet[] public bets;
    mapping(address => uint256) public lastBetTime;

    event BetPlaced(address indexed player, uint256 amount, BetType betType, uint8 betValue, uint256 round);
    event BetResult(address indexed player, uint256 amount, bool won, uint256 winnings, uint256 round);
    event RandomGenerated(uint256 randomNumber, uint256 round);
    event RequestAllowance(address indexed player, uint256 amount);


    constructor(IERC20 _token) Ownable(msg.sender) {
        require(address(_token) != address(0), "Invalid token");
        token = _token;
        minBet = 1 * 10**18; // 1 APTC
        currentRound = 1;
    }

    // Check if player has approved this contract to spend their tokens
    function checkUserAllowance(address user) public view returns (uint256) {
        return token.allowance(user, address(this));
    }

    modifier hasEnoughBalance(uint256 amount) {
        uint256 balance = token.balanceOf(msg.sender);
        require(balance >= 1 * 10**18, "Must have >= 1 APTC to play");
        require(amount >= minBet, "Below minimum bet");
        require(amount <= balance, "Bet exceeds wallet balance");
        _;
    }

    function placeBet(
        BetType betType,
        uint8 betValue,
        uint256 amount,
        uint256[] calldata numbers
    ) external nonReentrant hasEnoughBalance(amount) {
        uint256 currentAllowance = token.allowance(msg.sender, address(this));
        require(currentAllowance >= amount, string(abi.encodePacked("Insufficient allowance. Current: ", currentAllowance, " Required: ", amount)));
        
        uint256 timeSinceLastBet = block.timestamp - lastBetTime[msg.sender];
        require(timeSinceLastBet >= 3 seconds, string(abi.encodePacked("Must wait 3 seconds between bets. Time since last bet: ", timeSinceLastBet, " seconds")));
        
        require(block.number > lastBetBlock + MIN_WAIT_BLOCK, string(abi.encodePacked("Must wait at least ", MIN_WAIT_BLOCK, " blocks between bets")));
        
        require(token.transferFrom(msg.sender, address(this), amount), "Token transfer failed");

        validateBet(betType, betValue, numbers);

        bets.push(Bet({
            player: msg.sender,
            amount: amount,
            betType: betType,
            betValue: betValue,
            numbers: numbers,
            round: currentRound
        }));

        lastBetTime[msg.sender] = block.timestamp;

        emit BetPlaced(msg.sender, amount, betType, betValue, currentRound);

        generateRandomNumber();
        processBets();
    }

    function generateRandomNumber() internal {
        require(block.number > lastBetBlock + MIN_WAIT_BLOCK, "Wait at least 1 block");

        uint256 randomNumber = uint256(
            keccak256(
                abi.encodePacked(
                    blockhash(block.number - 1),
                    block.timestamp,
                    msg.sender,
                    nonce,
                    block.prevrandao
                )
            )
        );

        nonce++;
        lastBetBlock = block.number;
        randomResult = randomNumber % 37;

        emit RandomGenerated(randomResult, currentRound);
    }

    function processBets() internal {
        for (uint256 i = 0; i < bets.length; i++) {
            Bet memory bet = bets[i];
            if (bet.round != currentRound) continue;

            (bool won, uint256 winnings) = calculateWinnings(bet);

            if (won) {
                uint256 fee = (winnings * TREASURY_FEE_RATE) / 1000;
                uint256 payout = winnings - fee;

                require(token.transfer(bet.player, payout), "Player transfer failed");
                require(token.transfer(TREASURY, fee), "Treasury fee transfer failed");

                emit BetResult(bet.player, bet.amount, true, payout, bet.round);
            } else {
                require(token.transfer(TREASURY, bet.amount), "Loss goes to treasury");
                emit BetResult(bet.player, bet.amount, false, 0, bet.round);
            }
        }

        delete bets;
        currentRound++;
    }

    function validateBet(BetType betType, uint8 betValue, uint256[] calldata numbers) internal pure {
        if (betType == BetType.Number) {
            require(betValue <= 36 && numbers.length == 0, "Invalid Number bet");
        } else if (betType == BetType.Color || betType == BetType.OddEven || betType == BetType.HighLow) {
            require(betValue <= 1 && numbers.length == 0, "Invalid simple bet");
        } else if (betType == BetType.Dozen || betType == BetType.Column) {
            require(betValue <= 2 && numbers.length == 0, "Invalid Dozen/Column");
        } else if (betType == BetType.Split) {
            require(numbers.length == 2, "Split requires 2 numbers");
            validateNumbers(numbers, 2);
        } else if (betType == BetType.Street) {
            require(numbers.length == 3, "Street requires 3 numbers");
            validateNumbers(numbers, 3);
        } else if (betType == BetType.Corner) {
            require(numbers.length == 4, "Corner requires 4 numbers");
            validateNumbers(numbers, 4);
        } else if (betType == BetType.Line) {
            require(numbers.length == 6, "Line requires 6 numbers");
            validateNumbers(numbers, 6);
        }
    }

    function validateNumbers(uint256[] calldata numbers, uint256 count) internal pure {
        for (uint256 i = 0; i < count; i++) {
            require(numbers[i] <= 36, "Invalid number");
        }
    }

    function calculateWinnings(Bet memory bet) internal view returns (bool won, uint256 winnings) {
        if (bet.betType == BetType.Number && bet.betValue == randomResult) {
            return (true, bet.amount * 36);
        } else if (bet.betType == BetType.Color) {
            bool isRed = isRedNumber(randomResult);
            if ((bet.betValue == 0 && isRed) || (bet.betValue == 1 && !isRed)) return (true, bet.amount * 2);
        } else if (bet.betType == BetType.OddEven && randomResult != 0) {
            bool isEven = randomResult % 2 == 0;
            if ((bet.betValue == 0 && !isEven) || (bet.betValue == 1 && isEven)) return (true, bet.amount * 2);
        } else if (bet.betType == BetType.HighLow && randomResult != 0) {
            bool isHigh = randomResult >= 19;
            if ((bet.betValue == 0 && !isHigh) || (bet.betValue == 1 && isHigh)) return (true, bet.amount * 2);
        } else if (bet.betType == BetType.Dozen && randomResult != 0) {
            uint8 dozen = uint8((randomResult - 1) / 12);
            if (bet.betValue == dozen) return (true, bet.amount * 3);
        } else if (bet.betType == BetType.Column && randomResult != 0) {
            uint8 column = uint8((randomResult - 1) % 3);
            if (bet.betValue == column) return (true, bet.amount * 3);
        } else if (
            (bet.betType == BetType.Split ||
             bet.betType == BetType.Street ||
             bet.betType == BetType.Corner ||
             bet.betType == BetType.Line) &&
            containsNumber(bet.numbers, randomResult)
        ) {
            uint8 multiplier = bet.betType == BetType.Split ? 18 :
                               bet.betType == BetType.Street ? 12 :
                               bet.betType == BetType.Corner ? 9 :
                               6;
            return (true, bet.amount * multiplier);
        }

        return (false, 0);
    }

    function containsNumber(uint256[] memory numbers, uint256 target) internal pure returns (bool) {
        for (uint256 i = 0; i < numbers.length; i++) {
            if (numbers[i] == target) return true;
        }
        return false;
    }

    function isRedNumber(uint256 number) internal pure returns (bool) {
        uint256[18] memory redNumbers = [
            uint256(1), uint256(3), uint256(5), uint256(7), uint256(9),
            uint256(12), uint256(14), uint256(16), uint256(18), uint256(19),
            uint256(21), uint256(23), uint256(25), uint256(27), uint256(30),
            uint256(32), uint256(34), uint256(36)
        ];
        for (uint256 i = 0; i < redNumbers.length; i++) {
            if (redNumbers[i] == number) return true;
        }
        return false;
    }

    // --- Admin Functions ---
    function setMinBet(uint256 _minBet) external onlyOwner {
        require(_minBet > 0, "Min must be > 0");
        minBet = _minBet;
    }

    function withdrawTokens(uint256 amount) external onlyOwner {
        require(token.transfer(msg.sender, amount), "Withdraw failed");
    }

    function requestAllowance(uint256 amount) external payable {
        emit RequestAllowance(msg.sender, amount);
    }
}
