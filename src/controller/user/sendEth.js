import express from 'express';
import Web3 from 'web3';
import * as ethers from 'ethers';  // <- Import everything from ethers
import axios from 'axios';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from 'ecpair';
const ECPair = ECPairFactory(ecc);
import dotenv from 'dotenv';

dotenv.config();


// ---------------- Providers ----------------
const web3 = new Web3(process.env.INFURA_ETH_URL); // Ethereum Mainnet
const bnbProvider = new ethers.JsonRpcProvider('https://data-seed-prebsc-1-s1.binance.org:8545'); // BSC Testnet

// ---------------- ETH ----------------
export const sendEth = async (toAddress, amount) => {
  const privateKey = process.env.HOT_WALLET_PRIVATE_KEY;
  const account = web3.eth.accounts.privateKeyToAccount(privateKey);
  console.log("Sending ETH from:", account);
  web3.eth.accounts.wallet.add(account);

  const valueInWei = web3.utils.toWei(amount.toString(), 'ether');
  const balance = await web3.eth.getBalance(account.address);
  console.log("ETH Balance:", web3.utils.fromWei(balance, 'ether'), "ETH");
  if (BigInt(balance) < BigInt(valueInWei)) throw new Error(`Insufficient ETH. Balance: ${web3.utils.fromWei(balance, 'ether')} ETH`);

  const gasLimit = await web3.eth.estimateGas({ from: account.address, to: toAddress, value: valueInWei });
  const gasPrice = await web3.eth.getGasPrice();

  const tx = { from: account.address, to: toAddress, value: valueInWei, gas: gasLimit, gasPrice };
  const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
  const receipt = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);

  return receipt.transactionHash;
};

// ---------------- BNB ----------------
export const sendBnb = async (toAddress, amount) => {
  const wallet = new ethers.Wallet(process.env.HOT_WALLET_PRIVATE_KEY, bnbProvider);
  const valueInBNB = ethers.parseEther(amount.toString());

  const balance = await bnbProvider.getBalance(wallet.address);
  if (balance < valueInBNB) throw new Error(`Insufficient BNB. Balance: ${ethers.formatEther(balance)} BNB`);

  const tx = await wallet.sendTransaction({ to: toAddress, value: valueInBNB });
  const receipt = await tx.wait();
  return receipt.transactionHash;
};

// ---------------- USDT (ERC20) ----------------
export const sendUsdt = async (toAddress, amount) => {
  const wallet = new ethers.Wallet(process.env.HOT_WALLET_PRIVATE_KEY, bnbProvider); // BNB Testnet or ETH Mainnet
  const usdtContract = new ethers.Contract(
    process.env.USDT_CONTRACT_ADDRESS,
    [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint amount) returns (bool)',
    ],
    wallet
  );

  const decimals = 6;
  const amountInUnits = ethers.parseUnits(amount.toString(), decimals);

  const balance = await usdtContract.balanceOf(wallet.address);
  if (balance < amountInUnits) throw new Error(`Insufficient USDT. Balance: ${ethers.formatUnits(balance, decimals)} USDT`);

  const tx = await usdtContract.transfer(toAddress, amountInUnits);
  const receipt = await tx.wait();
  return receipt.transactionHash;
};

// ---------------- BTC (Testnet) ----------------
export const sendBtc = async (toAddress, amount) => {
  const network = bitcoin.networks.testnet;

  // ✅ address validation
  if (!toAddress || typeof toAddress !== "string") {
    throw new Error("Invalid BTC address");
  }

  // ✅ load private key
  const privateKeyWIF = process.env.BTC_TESTNET_PRIVATE_KEY;
  if (!privateKeyWIF) {
    throw new Error("BTC_TESTNET_PRIVATE_KEY missing in .env");
  }

  // ✅ correct key loading
  let keyPair;
  try {
    keyPair = ECPair.fromWIF(privateKeyWIF, network);
  } catch (err) {
    throw new Error("Invalid TESTNET WIF private key");
  }

  // ✅ sender address
  const payment = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network,
  });

  const fromAddress = payment.address;
  const outputScript = payment.output;

  console.log("Sending BTC from:", fromAddress);

  // ✅ BTC → sats
  const btcAmount = Number(amount);
  if (!btcAmount || btcAmount <= 0) {
    throw new Error("Invalid BTC amount");
  }

  const amountSats = Math.round(btcAmount * 1e8);
  const fee = 10000;

  // ✅ fetch UTXOs
  const { data: utxos } = await axios.get(
    `https://mempool.space/testnet/api/address/${fromAddress}/utxo`
  );

  if (!utxos.length) {
    throw new Error("No BTC balance available (fund this address)");
  }

  const psbt = new bitcoin.Psbt({ network });
  let inputSum = 0;

  for (const utxo of utxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: outputScript,
        value: utxo.value,
      },
    });

    inputSum += utxo.value;
    if (inputSum >= amountSats + fee) break;
  }

  if (inputSum < amountSats + fee) {
    throw new Error("Insufficient BTC balance");
  }

  // ✅ receiver
  psbt.addOutput({
    address: toAddress,
    value: amountSats,
  });

  // ✅ change
  const change = inputSum - amountSats - fee;
  if (change > 0) {
    psbt.addOutput({
      address: fromAddress,
      value: change,
    });
  }

  // ✅ sign & finalize
  psbt.signAllInputs(keyPair);
  psbt.finalizeAllInputs();

  const txHex = psbt.extractTransaction().toHex();

  // ✅ broadcast
  const { data: txid } = await axios.post(
    "https://mempool.space/testnet/api/tx",
    txHex,
    { headers: { "Content-Type": "text/plain" } }
  );

  return txid;
};