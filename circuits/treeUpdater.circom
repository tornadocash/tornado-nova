include "./merkleTree.circom";

// inserts a subtree into a merkle tree
// checks that tree previously contained zeroes is the same positions
// zeroSubtreeRoot is a root of a subtree that contains only zeroes
template TreeUpdater(levels, subtreeLevels, zeroSubtreeRoot) {
    // currently it works only with 1-level subtrees
    assert(subtreeLevels == 1);
    var remainingLevels = levels - subtreeLevels;

    signal input oldRoot;
    signal input newRoot;
    signal input leaf[1 << subtreeLevels];
    signal input pathIndices;
    signal private input pathElements[remainingLevels];

    // calculate subtree root
    // todo: make it work with arbitrary subtree levels
    // currently it works only with 1-level subtrees
    component leafPair = HashLeftRight();
    leafPair.left <== leaf[0];
    leafPair.right <== leaf[1];

    component treeBefore = MerkleTree(remainingLevels);
    for(var i = 0; i < remainingLevels; i++) {
        treeBefore.pathElements[i] <== pathElements[i];
    }
    treeBefore.pathIndices <== pathIndices;
    treeBefore.leaf <== zeroSubtreeRoot;
    treeBefore.root === oldRoot;

    component treeAfter = MerkleTree(remainingLevels);
    for(var i = 0; i < remainingLevels; i++) {
        treeAfter.pathElements[i] <== pathElements[i];
    }
    treeAfter.pathIndices <== pathIndices;
    treeAfter.leaf <== leafPair.hash;
    treeAfter.root === newRoot;
}
