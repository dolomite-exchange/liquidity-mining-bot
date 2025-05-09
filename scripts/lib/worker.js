const { parentPort } = require('worker_threads');
const { MerkleTree } = require('merkletreejs');
const { keccak256 } = require('ethers/lib/utils');

parentPort.on('message', ({ leaves, leaf }) => {
  const tree = new MerkleTree(leaves, keccak256, { sort: true });
  parentPort.postMessage(tree.getHexProof(leaf));
});
