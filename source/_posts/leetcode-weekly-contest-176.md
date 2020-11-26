---
title: Leetcode Weekly Contest 176 题解
type: tags
date: 2020-02-23 21:00:00
tags: [Python,编程,leetcode,刷题]
categories: [编程,leetcode,刷题]
toc: true
---

emmmm，我的拖延症没救了，顺便加上这周沉迷 Kotlin ，这篇本应该周一就写完的题解拖到现在，= =然而这周双周赛，，我又得写两篇题解了。。。

<!--more-->

## 1351. Count Negative Numbers in a Sorted Matrix

题面：

> Given a m * n matrix grid which is sorted in non-increasing order both row-wise and column-wise. 
> Return the number of negative numbers in grid.

示例：

```text
Input: grid = [[4,3,2,-1],[3,2,1,-1],[1,1,-1,-2],[-1,-1,-2,-3]]
Output: 8
Explanation: There are 8 negatives number in the matrix.
```

题面很简单，给定一个矩阵，矩阵横/纵向都是递减的，求这个矩阵中负数的个数，这个题，因为横/纵向的数据规模都是小于100的，那就没啥说的了，，直接暴力，横向遍历，然后遇到负数就停止遍历

```python
from typing import List


class Solution:
    def countNegatives(self, grid: List[List[int]]) -> int:
        if not grid:
            return 0
        n_length = len(grid[0])
        result = 0
        for item in grid:
            for i in range(n_length):
                if item[i] < 0:
                    result += n_length - i
                    break
        return result
```

## 1352. Product of the Last K Numbers

题面:

```text
Implement the class ProductOfNumbers that supports two methods:

1. add(int num)

Adds the number num to the back of the current list of numbers.
2. getProduct(int k)

Returns the product of the last k numbers in the current list.
You can assume that always the current list has at least k numbers.
At any time, the product of any contiguous sequence of numbers will fit into a single 32-bit integer without overflowing.
```

示例

```text
Input
["ProductOfNumbers","add","add","add","add","add","getProduct","getProduct","getProduct","add","getProduct"]
[[],[3],[0],[2],[5],[4],[2],[3],[4],[8],[2]]

Output
[null,null,null,null,null,null,20,40,0,null,32]

Explanation
ProductOfNumbers productOfNumbers = new ProductOfNumbers();
productOfNumbers.add(3);        // [3]
productOfNumbers.add(0);        // [3,0]
productOfNumbers.add(2);        // [3,0,2]
productOfNumbers.add(5);        // [3,0,2,5]
productOfNumbers.add(4);        // [3,0,2,5,4]
productOfNumbers.getProduct(2); // return 20. The product of the last 2 numbers is 5 * 4 = 20
productOfNumbers.getProduct(3); // return 40. The product of the last 3 numbers is 2 * 5 * 4 = 40
productOfNumbers.getProduct(4); // return 0. The product of the last 4 numbers is 0 * 2 * 5 * 4 = 0
productOfNumbers.add(8);        // [3,0,2,5,4,8]
productOfNumbers.getProduct(2); // return 32. The product of the last 2 numbers is 4 * 8 = 32 
```

题面很简单，设计一个数据结构，提供一个 `add` 方法，让用户能够往里面添加速度，提供一个 `getProduct` 方法，让用户能求倒数K个数的乘积，这题没啥好说的，直接暴力写，中间加个 hashmap 作为缓存

```python
from typing import List, Dict
import bisect
from operator import mul
from functools import reduce


class ProductOfNumbers:
    _value: List[int]
    _cache_result: Dict[int, int]
    _cache_index: List[int]

    def __init__(self):
        self._value = []
        self._cache_result = {}
        self._cache_index = []

    def add(self, num: int) -> None:
        self._value.append(num)
        self._cache_index.clear()
        self._cache_result.clear()

    def getProduct(self, k: int) -> int:
        if k in self._cache_result:
            return self._cache_result[k]
        cache_index = bisect.bisect(self._cache_index, k) - 1
        if cache_index >= 0:
            last_k = self._cache_index[cache_index]
            result = self._cache_result[last_k]
            for i in range(1, cache_index + 1):
                temp_last_k = last_k + i
                if temp_last_k >= len(self._value):
                    break
                result *= self._value[-last_k]
        else:
            temp_value = (
                self._value[-1 : -k - 1 : -1] if k <= len(self._value) else self._value
            )
            result = reduce(mul, temp_value, 1)
        bisect.bisect_left(self._cache_index, k)
        self._cache_result[k] = result
        return result
```

## 1353. Maximum Number of Events That Can Be Attended

题面：

> Given an array of events where events[i] = [startDayi, endDayi]. Every event i starts at startDayi and ends at endDayi.
> You can attend an event i at any day d where startTimei <= d <= endTimei. Notice that you can only attend one event at any time d.
> Return the maximum number of events you can attend.

示例

![image](https://user-images.githubusercontent.com/7054676/75112667-e110d200-5680-11ea-8686-80f04332fe44.png)

```text
Input: events = [[1,2],[2,3],[3,4]]
Output: 3
Explanation: You can attend all the three events.
One way to attend them all is as shown.
Attend the first event on day 1.
Attend the second event on day 2.
Attend the third event on day 3.
```

给定一个数组，数组中每个元素 x 代表一个活动，x[0], x[i] 代表该活动的起始与结束时间，一个用户一天只能参加一个活动，求用户最多能参加多少个活动。经典的一个贪心题目，首先对活动列表以结束时间进行排序，然后依次遍历每个时间，确认具体哪一天可以参加，整体时间复杂度为 O(max(nlogn,n*m))

```python
from typing import List, Dict


class Solution:
    def maxEvents(self, events: List[List[int]]) -> int:
        if not events:
            return 0
        events_size = len(events)
        if events_size == 1:
            return 1
        events = sorted(events)
        _day_map: Dict[str, bool] = {}
        _event_map: Dict[int, bool] = {}
        count = 0
        for i in range(events_size):
            for j in range(events[i][0], events[i][1]+1):
                temp = "{}".format(j)
                if temp not in _day_map and i not in _event_map:
                    count += 1
                    _day_map[temp] = True
                    _event_map[i] = True
        return count
```

## 1354. Construct Target Array With Multiple Sums

题面

> Given an array of integers target. From a starting array, A consisting of all 1's, you may perform the following procedure :
> * let x be the sum of all elements currently in your array.
> * choose index i, such that 0 <= i < target.size and set the value of A at index i to x.
> * You may repeat this procedure as many times as needed.
> Return True if it is possible to construct the target array from A otherwise return False.

示例：

```text
Input: target = [9,3,5]
Output: true
Explanation: Start with [1, 1, 1] 
[1, 1, 1], sum = 3 choose index 1
[1, 3, 1], sum = 5 choose index 2
[1, 3, 5], sum = 9 choose index 0
[9, 3, 5] Done
```

这题算是一个数学题吧，我们首先知道数组中所有的元素的和一定大于数组中每个元素（这不是废话），然后我们假定有这样一个数组 [1,1,9,17,63] ，我们可以往回迭代上一个数组结构是 [1,1,9.17,33] ，然后我们还可以向前迭代一次 [1,1,9,17,5]  然后当前的数字已经不再是数组中最大的数字，于是我们开始寻找下一个数组中最大的数字进行迭代

这里我们也可以发现，数组中最大数字的最原始版本的值是当前数字对其余数字的和的模，于是我们就这样一直迭代就 OK 了

好了，上代码

```python
import heapq
from typing import List


class Solution:
    def isPossible(self, target: List[int]) -> bool:
        if not target:
            return False
        total = sum(target)
        target = sorted([-x for x in target])
        heapq.heapify(target)
        while True:
            a = -heapq.heappop(target)
            total -= a
            if a == 1 or total == 1:
                return True
            if a < total or total == 0 or a % total == 0:
                return False
            a %= total
            total += a
            heapq.heappush(target, -a)
```

## 总结

这次的题还是周赛的常规水平，然而我刷题实在是太少了QAQ
