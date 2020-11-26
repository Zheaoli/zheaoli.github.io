---
title: Leetcode Weekly Contest 174 题解
type: tags
date: 2020-02-02 15:00:00
tags: [Python,编程,leetcode,刷题]
categories: [编程,leetcode,刷题]
toc: true
---

最近因为生病好久没刷题，今早开始打了一场 Leetcode 的周赛，来写个题解，今早状态还行，，BTW 以后每周都会打周赛，争取写题解

<!--more-->

## Leetcode 1341. The K Weakest Rows in a Matrix

描述：

> Given a m * n matrix mat of ones (representing soldiers) and zeros (representing civilians), return the indexes of the k weakest rows in the matrix ordered from the weakest to the strongest.
> A row i is weaker than row j, if the number of soldiers in row i is less than the number of soldiers in row j, or they have the same number of soldiers but i is less than j. Soldiers are always stand in the frontier of a row, that is, always ones may appear first and then zeros.

Example 1:

```text
Input: mat = 
[[1,1,0,0,0],
 [1,1,1,1,0],
 [1,0,0,0,0],
 [1,1,0,0,0],
 [1,1,1,1,1]], 
k = 3
Output: [2,0,3]
Explanation: 
The number of soldiers for each row is: 
row 0 -> 2 
row 1 -> 4 
row 2 -> 1 
row 3 -> 2 
row 4 -> 5 
Rows ordered from the weakest to the strongest are [2,0,3,1,4]
```

题面很简单，其实这道题就是二进制的处理，Python 里面就暴力出奇迹了

```python
from typing import List


class Solution:
    def kWeakestRows(self, mat: List[List[int]], k: int) -> List[int]:
        if not mat:
            return []
        number = []
        for i in range(len(mat)):
            number.append((int("".join([str(x) for x in mat[i]]), 2), i))
        number.sort()
        return [x for _, x in number[0:k]]
```

## 1342. Reduce Array Size to The Half

描述：

> Given an array arr.  You can choose a set of integers and remove all the occurrences of these integers in the array.
> Return the minimum size of the set so that at least half of the integers of the array are removed.

```text
Input: arr = [3,3,3,3,5,5,5,2,2,7]
Output: 2
Explanation: Choosing {3,7} will make the new array [5,5,5,2,2] which has size 5 (i.e equal to half of the size of the old array).
Possible sets of size 2 are {3,5},{3,2},{5,2}.
Choosing set {2,7} is not possible as it will make the new array [3,3,3,3,5,5,5] which has size greater than half of the size of the old array.
```

这个题题面也很简单，给定一个数组，选择一组数字移除，被移除后的数组数量小于等于之前的一半，求最少选择多少数字能达到要求

哈希表，O(N) 的做法

```python
from typing import List


class Solution:
    def minSetSize(self, arr: List[int]) -> int:
        if not arr:
            return 0
        counter = {}
        for i in arr:
            counter[i] = counter.setdefault(i, 0) + 1
        counter = {k: v for k, v in sorted(counter.items(), key=lambda item: item[1], reverse=True)}
        total_count = 0
        result_count = 0
        for i, count in counter.items():
            total_count += count
            result_count += 1
            if total_count >= len(arr) / 2:
                break
        return result_count
```

### 1343. Maximum Product of Splitted Binary Tree

描述：

> Given a binary tree root. Split the binary tree into two subtrees by removing 1 edge such that the product of the sums of the subtrees are maximized.
> Since the answer may be too large, return it modulo 10^9 + 7.

Example 1:

![](https://assets.leetcode.com/uploads/2020/01/21/sample_1_1699.png)

```text
Input: root = [1,2,3,4,5,6]
Output: 110
Explanation: Remove the red edge and get 2 binary trees with sum 11 and 10. Their product is 110 (11*10)
```

这个题的题面也很简单，给定一个带值的二叉树，移除某个二叉树的边，使之分割成为两个新的二叉树，求两个二叉树和的乘积最大

最开始很多人会被这道题唬到，但是实际上这道题就是一个二叉树的遍历，无论前中后序遍历，先遍历一次二叉树，求出二叉树节点值的总和，以及每个节点的左子树的和 left_sum 以及右子树的总和 `right_sum` 

然后再次遍历，`result=max((total_sum-left_sum)*left_sum),(total_sum-right_sum)*right_sum),result)` 暴力求解即可

```python
class TreeNode:
    def __init__(self, x):
        self.val = x
        self.left = None
        self.right = None

class Solution:
    def maxProduct(self, root: TreeNode) -> int:
        total_sum = self.sum_node(root)
        result = 0
        stack = []
        node = root
        while node or stack:
            while node:
                stack.append(node)
                result = max(result, ((total_sum - node.left_sum) * node.left_sum))
                result = max(result, ((total_sum - node.right_sum) * node.right_sum))
                node = node.left
            node = stack.pop()
            node = node.right
            if node:
                result = max(result, ((total_sum - node.right_sum) * node.right_sum))
                result = max(result, ((total_sum - node.left_sum) * node.left_sum))
        return result % (10 ** 9 + 7)

    def sum_node(self, root: TreeNode) -> int:
        if not root:
            return 0
        left_sum = self.sum_node(root.left)
        right_sum = self.sum_node(root.right)
        root.left_sum = left_sum
        root.right_sum = right_sum
        return left_sum + right_sum + root.val
```

BTW 这段代码的 type hint 使用其实有点问题，我后面比赛完了改了一版

```python
from typing import Optional, Tuple, List


class TreeNode:
    val: int
    left: Optional["TreeNode"]
    right: Optional["TreeNode"]

    def __init__(self, x):
        self.val = x
        self.left = None
        self.right = None


class TreeNodeWithSum:
    val: int
    left: Optional["TreeNodeWithSum"]
    right: Optional["TreeNodeWithSum"]
    left_sum: int
    right_sum: int

    def __init__(
        self,
        x: int,
        left: Optional["TreeNodeWithSum"],
        right: Optional["TreeNodeWithSum"],
        left_sum: int,
        right_sum: int,
    ):
        self.val = x
        self.left = left
        self.right = right
        self.left_sum = left_sum
        self.right_sum = right_sum


class Solution:
    def maxProduct(self, root: TreeNode) -> int:
        total_sum,new_root = self.sum_node(root)
        result = 0
        stack:List[TreeNodeWithSum] = []
        node = new_root
        while node or stack:
            while node:
                stack.append(node)
                result = max(result, ((total_sum - node.left_sum) * node.left_sum))
                result = max(result, ((total_sum - node.right_sum) * node.right_sum))
                node = node.left
            node = stack.pop()
            node = node.right
            if node:
                result = max(result, ((total_sum - node.right_sum) * node.right_sum))
                result = max(result, ((total_sum - node.left_sum) * node.left_sum))
        return result % (10 ** 9 + 7)

    def sum_node(
        self, root: Optional[TreeNode]
    ) -> Tuple[int, Optional[TreeNodeWithSum]]:
        if not root:
            return 0, None
        left_sum, new_left_node = self.sum_node(root.left)
        right_sum, new_right_node = self.sum_node(root.right)
        return (
            left_sum + right_sum + root.val,
            TreeNodeWithSum(
                root.val, new_left_node, new_right_node, left_sum, right_sum
            ),
        )

```

BTW，这道题因为数据太大，需要对 10^9+7 取模，我智障的忘了取模，WA 了两次，罚时罚哭。。。我真的太菜了。。

## 1344. Jump Game V

描述：

> Given an array of integers arr and an integer d. In one step you can jump from index i to index:
> i + x where: i + x < arr.length and 0 < x <= d.
> i - x where: i - x >= 0 and 0 < x <= d.
> In addition, you can only jump from index i to index j if arr[i] > arr[j] and arr[i] > arr[k] for all indices k between i and j (More formally min(i, j) < k < max(i, j)).
> You can choose any index of the array and start jumping. Return the maximum number of indices you can visit.
> Notice that you can not jump outside of the array at any time.

![](https://assets.leetcode.com/uploads/2020/01/23/meta-chart.jpeg)

```text
Input: arr = [6,4,14,6,8,13,9,7,10,6,12], d = 2
Output: 4
Explanation: You can start at index 10. You can jump 10 --> 8 --> 6 --> 7 as shown.
Note that if you start at index 6 you can only jump to index 7. You cannot jump to index 5 because 13 > 9. You cannot jump to index 4 because index 5 is between index 4 and 6 and 13 > 9.
Similarly You cannot jump from index 3 to index 2 or index 1.
```

这题的题面是这样，一个数组，里面有若干值，你可以从任意一个位置开始跳跃，一次只能跳一个，跳的时候需要满足规则，假定你从数组 i 位置起跳，每次可跳的范围是 x，那么你需要满足

1. i+x < arr.length 和 0<x<=d

2. i-x >=0 和 0<x<=d

同时假设你从 i 跳往 j，那么你需要保证 arr[i]>arr[j] 且 i 到 j 中的每个元素都满足 arr[j]<x<arr[i]，求最多能跳多少个元素

最开始觉得这题是一个双头 DP 的题，嫌写起来恶心就懒得写，，但是后面比赛完了发现其实这个题其实单 DP 就能解决的，因为我们只能从高往低跳，于是我们可以先将元素排序后依次遍历，可以得出公式为 `dp[i]=max(dp[i]+dp[j]+1)` 其中 j 是从 i 起可以到达的索引值，DP 部分的复杂度为 O(DN) 但是因为需要提前排序，因此整体的时间复杂度为 O(logN+DN)

```python
from typing import List


class Solution:
    def maxJumps(self, arr: List[int], d: int) -> int:
        length = len(arr)
        dp = [1] * length
        for a, i in sorted([a, i] for i, a in enumerate(arr)):
            for di in [-1, 1]:
                for j in range(i + di, i + d * di + di, di):
                    if not (0 <= j < length and arr[j] < arr[i]):
                        break
                    dp[i] = max(dp[i], dp[j] + 1)

        return max(dp)
```

## 总结

很久没刷题了，手还是有点生，在前面几个签到题上花了时间，，而且犯了低级错误，，所以以后一定要坚持刷题了。。BTW 这次的周赛题感觉都很简单，感觉像是被泄题后找的 Backup，好了就先这样吧，我继续卧床养病了。。