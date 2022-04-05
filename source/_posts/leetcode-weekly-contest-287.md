---
title: Leetcode Weekly Contest 287 题解
type: tags
date: 2022-04-05 21:00:00
tags: [Python,编程,leetcode,刷题]
categories: [编程,leetcode,刷题]
toc: true
---

好久没打周赛了，打了一次周赛，简单的写个题解

<!--more-->

## 2224. Minimum Number of Operations to Convert Time

题面：

```text
You are given two strings current and correct representing two 24-hour times.

24-hour times are formatted as "HH:MM", where HH is between 00 and 23, and MM is between 00 and 59. The earliest 24-hour time is 00:00, and the latest is 23:59.

In one operation you can increase the time current by 1, 5, 15, or 60 minutes. You can perform this operation any number of times.

Return the minimum number of operations needed to convert current to correct.
```

示例：

```text
 

Example 1:

Input: current = "02:30", correct = "04:35"
Output: 3
Explanation:
We can convert current to correct in 3 operations as follows:
- Add 60 minutes to current. current becomes "03:30".
- Add 60 minutes to current. current becomes "04:30".
- Add 5 minutes to current. current becomes "04:35".
It can be proven that it is not possible to convert current to correct in fewer than 3 operations.

Example 2:

Input: current = "11:00", correct = "11:01"
Output: 1
Explanation: We only have to add one minute to current, so the minimum number of operations needed is 1.
```

这题没啥好说的吧，直接暴力计算时间写就行

```python
class Solution:
    def convertTime(self, current: str, correct: str) -> int:
        correct_time = correct.split(':')
        current_time = current.split(':')
        minutes = int(correct_time[1]) - int(current_time[1])
        hours = int(correct_time[0]) - int(current_time[0])
        if correct_time[1] < current_time[1]:
            minutes += 60
            hours -= 1
        results = hours
        flag = [15, 5, 1]
        for i in flag:
            if minutes >= i:
                results += (minutes // i)
                minutes = minutes % i
        return results
```

## 2225. Find Players With Zero or One Losses

题面：

```text
You are given an integer array matches where matches[i] = [winneri, loseri] indicates that the player winneri defeated player loseri in a match.

Return a list answer of size 2 where:

answer[0] is a list of all players that have not lost any matches.
answer[1] is a list of all players that have lost exactly one match.
The values in the two lists should be returned in increasing order.

Note:

You should only consider the players that have played at least one match.
The testcases will be generated such that no two matches will have the same outcome.
```

示例：

```text
Example 1:

Input: matches = [[1,3],[2,3],[3,6],[5,6],[5,7],[4,5],[4,8],[4,9],[10,4],[10,9]]
Output: [[1,2,10],[4,5,7,8]]
Explanation:
Players 1, 2, and 10 have not lost any matches.
Players 4, 5, 7, and 8 each have lost one match.
Players 3, 6, and 9 each have lost two matches.
Thus, answer[0] = [1,2,10] and answer[1] = [4,5,7,8].


Example 2:

Input: matches = [[2,3],[1,3],[5,4],[6,4]]
Output: [[1,2,5,6],[]]
Explanation:
Players 1, 2, 5, and 6 have not lost any matches.
Players 3 and 4 each have lost two matches.
Thus, answer[0] = [1,2,5,6] and answer[1] = [].
```

这题实际上就遍历统计就行，时间复杂度 O(N) 空间复杂度 O(N)

```python
from collections import defaultdict
from typing import List


class Solution:
    def findWinners(self, matches: List[List[int]]) -> List[List[int]]:
        index = defaultdict(lambda: [0, 0])
        for winner, loser in matches:
            index[winner][0] += 1
            index[loser][1] += 1
        return [
            sorted([k for k, v in index.items() if v[0] > 0 and v[1] == 0]),
            sorted([k for k, v in index.items() if v[1] == 1]),
        ]
```

## 2226. Maximum Candies Allocated to K Children

草，这题题号真有意思，尊。。。。

题面：

```text

You are given a 0-indexed integer array candies. Each element in the array denotes a pile of candies of size candies[i]. You can divide each pile into any number of sub piles, but you cannot merge two piles together.

You are also given an integer k. You should allocate piles of candies to k children such that each child gets the same number of candies. Each child can take at most one pile of candies and some piles of candies may go unused.

Return the maximum number of candies each child can get.
```

示例：

```text
Example 1:

Input: candies = [5,8,6], k = 3
Output: 5
Explanation: We can divide candies[1] into 2 piles of size 5 and 3, and candies[2] into 2 piles of size 5 and 1. We now have five piles of candies of sizes 5, 5, 3, 5, and 1. We can allocate the 3 piles of size 5 to 3 children. It can be proven that each child cannot receive more than 5 candies.

Example 2:

Input: candies = [2,5], k = 11
Output: 0
Explanation: There are 11 children but only 7 candies in total, so it is impossible to ensure each child receives at least one candy. Thus, each child gets no candy and the answer is 0.
```

这题实际上最开始没想清楚，后面仔细想了下，实际上是个二分的题目

首先假设，我们所有的糖的和为 y, 假设被 k 整除后的值是 z（含义是最大的能够整数分割的数），那么我们题目里孩子能获得的最大的糖果的数量的值域一定是 [0,z]

这个区间是具备单调性（单调递增），那么就具备了二分的条件。那么我们二分的题目是什么？假设中间值是 mid ，我们计算每推糖果能够按照 mid 分成几份并求和，如果和小于 k ，那么意味着值比我们目标值大，否则则比目标值小。持续逼近即可

```Python
from typing import List


class Solution:
    def maximumCandies(self, candies: List[int], k: int) -> int:
        left, right = 0, sum(candies) // k
        while left < right:
            mid = (left + right + 1) // 2
            if k > sum(candy // mid for candy in candies):
                right = mid - 1
            else:
                left = mid
        return left
```

## 2227. Encrypt and Decrypt Strings

这题实际上比第三题简单

题面：

```text
You are given a character array keys containing unique characters and a string array values containing strings of length 2. You are also given another string array dictionary that contains all permitted original strings after decryption. You should implement a data structure that can encrypt or decrypt a 0-indexed string.

A string is encrypted with the following process:

For each character c in the string, we find the index i satisfying keys[i] == c in keys.
Replace c with values[i] in the string.
A string is decrypted with the following process:

For each substring s of length 2 occurring at an even index in the string, we find an i such that values[i] == s. If there are multiple valid i, we choose any one of them. This means a string could have multiple possible strings it can decrypt to.
Replace s with keys[i] in the string.
Implement the Encrypter class:

Encrypter(char[] keys, String[] values, String[] dictionary) Initializes the Encrypter class with keys, values, and dictionary.
String encrypt(String word1) Encrypts word1 with the encryption process described above and returns the encrypted string.
int decrypt(String word2) Returns the number of possible strings word2 could decrypt to that also appear in dictionary.

```

示例：

```text
Input
["Encrypter", "encrypt", "decrypt"]
[[['a', 'b', 'c', 'd'], ["ei", "zf", "ei", "am"], ["abcd", "acbd", "adbc", "badc", "dacb", "cadb", "cbda", "abad"]], ["abcd"], ["eizfeiam"]]
Output
[null, "eizfeiam", 2]

Explanation
Encrypter encrypter = new Encrypter([['a', 'b', 'c', 'd'], ["ei", "zf", "ei", "am"], ["abcd", "acbd", "adbc", "badc", "dacb", "cadb", "cbda", "abad"]);
encrypter.encrypt("abcd"); // return "eizfeiam". 
                           // 'a' maps to "ei", 'b' maps to "zf", 'c' maps to "ei", and 'd' maps to "am".
encrypter.decrypt("eizfeiam"); // return 2. 
                              // "ei" can map to 'a' or 'c', "zf" maps to 'b', and "am" maps to 'd'. 
                              // Thus, the possible strings after decryption are "abad", "cbad", "abcd", and "cbcd". 
                              // 2 of those strings, "abad" and "abcd", appear in dictionary, so the answer is 2.
```

这题加密部分其实直接按照规则写就行了，然后解密部分有个方法就是提前将字典里面的值预计算一次，然后就能 O(1) 计算了

```python
from collections import Counter
from typing import List


class Encrypter:
    def __init__(self, keys: List[str], values: List[str], dictionary: List[str]):
        self.index = {k: v for k, v in zip(keys, values)}
        self.counter = Counter(self.encrypt(item) for item in dictionary)

    def encrypt(self, word1: str) -> str:
        return "".join(self.index[letter] for letter in word1)

    def decrypt(self, word2: str) -> int:
        return self.counter[word2]
```

