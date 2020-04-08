include "./merkleTree.circom";

// inserts a pair of leaves into a tree
// checks that tree previously contained zeroes is same positions
// zeroLeaf is a second level leaf: `hash(0, 0)`
template TreeUpdater(n, zeroLeaf) {
    signal input oldRoot;
    signal input newRoot;
    signal input leaf[2];
    signal input pathIndices;
    signal private input pathElements[n - 1];

    component leafPair = HashLeftRight();
    leafPair.left <== leaf[0];
    leafPair.right <== leaf[1];

    component treeBefore = MerkleTree(n - 1);
    for(var i = 0; i < n - 1; i++) {
        treeBefore.pathElements[i] <== pathElements[i];
    }
    treeBefore.pathIndices <== pathIndices;
    treeBefore.leaf <== zeroLeaf;
    treeBefore.root === oldRoot;

    component treeAfter = MerkleTree(n - 1);
    for(var i = 0; i < n - 1; i++) {
        treeAfter.pathElements[i] <== pathElements[i];
    }
    treeAfter.pathIndices <== pathIndices;
    treeAfter.leaf <== leafPair.hash;
    treeAfter.root === newRoot;
}