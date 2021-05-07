---
title: Leetcode BiWeekly Contest 19 题解
type: tags
date: 2020-02-11 01:00:00
tags: [Python,编程,leetcode,刷题]
categories: [编程,leetcode,刷题]
toc: true
---

例行 Leetcode 周赛，这周双周赛，两场赛打下来，有点酸爽，先写个 BiWeekly 19 Contest 的题解吧

<!--more-->

## 1342. Number of Steps to Reduce a Number to Zer

题面：

> Given a non-negative integer num, return the number of steps to reduce it to zero. If the current number is even, you have to divide it by 2, otherwise, you have to subtract 1 from it.

示例：

```text
Input: num = 14
Output: 6
Explanation:
    Step 1) 14 is even; divide by 2 and obtain 7. 
    Step 2) 7 is odd; subtract 1 and obtain 6.
    Step 3) 6 is even; divide by 2 and obtain 3. 
    Step 4) 3 is odd; subtract 1 and obtain 2. 
    Step 5) 2 is even; divide by 2 and obtain 1. 
    Step 6) 1 is odd; subtract 1 and obtain 0.
```

这个题题面很简单，一个非负整数，偶数除2，奇数减1，求需要多少步到0

暴力写

```python
class Solution:
    def numberOfSteps(self, num: int) -> int:
        count = 0
        if num == 0:
            return count
        result = num
        while result > 1:
            if result % 2 == 0:
                result = int(result / 2)
            else:
                result -= 1
            count += 1
        return count + 1
```

## Number of Sub-arrays of Size K and Average Greater than or Equal to Threshold

题面：

> Given an array of integers arr and two integers k and threshold.
> Return the number of sub-arrays of size k and average greater than or equal to threshold.

示例：

```text
Input: arr = [2,2,2,2,5,5,5,8], k = 3, threshold = 4
Output: 3
Explanation: Sub-arrays [2,5,5],[5,5,5] and [5,5,8] have averages 4, 5 and 6 respectively. All other sub-arrays of size 3 have averages less than 4 (the threshold)
```

给定一个数组和一个长度 k，和一个阈值 threshold ，求这个数组中的所有长度为 K 且平均数大于等于阈值的子数组的个数。这个题，暴力写很简单，一个简单的数组的拆分，`sum(arr[i:i+k])/k >= threshold` 即可，但是这里有个问题，如果实时求和，那么时间复杂度为 O(M*K) M 为数组的长度，这个时候暴力会 T 

因此需要做个小技巧的优化。可以考虑这样这样一个做法，假设当前 i 及其后 k 个数的和为 sum[i]，那么有这样一个公式，sum[i]=sum[i-1]-arr[i]+arr[i+k-1]，这样每次计算和都是 O(1) 的复杂度，那么整体就是一个 O(N) 的做法

好了，暴力开写

```python
from typing import List


class Solution:
    def numOfSubarrays(self, arr: List[int], k: int, threshold: int) -> int:
        if not arr:
            return 0
        length = len(arr)
        sum_threshold = [0.0] * length
        count = 0
        last_index = length
        for i in range(length - k, -1, -1):
            if i == length - k:
                total_sum = sum(arr[i:i + k])
            else:
                total_sum = sum_threshold[i + 1] - arr[last_index] + arr[i]
            sum_threshold[i] = total_sum

            if total_sum / k >= threshold:
                count += 1
            last_index -= 1
        return count
```

### 1344. Angle Between Hands of a Clock

题面：

> Given two numbers, hour and minutes. Return the smaller angle (in sexagesimal units) formed between the hour and the minute hand.

示例：

![image](https://user-images.githubusercontent.com/7054676/74172911-0b6b9400-4c6c-11ea-8c8b-07e22630428b.png)

```text
Input: hour = 12, minutes = 30
Output: 165
```

求某个时刻，时针与分针的夹角，，，啊，，我的上帝呀，一度梦回小升初。。。一个数学题，首先科普如下知识

1. 普通钟表相当于圆，其时针或分针走一圈均相当于走过360°角；

2. 钟表上的每一个大格（时针的一小时或分针的5分钟）对应的角度是：360°/12=30°；

3. 时针每走过1分钟对应的角度应为：360°/(12*60)=0.5°；

4. 分针每走过1分钟对应的角度应为：360°/60=6°。

好了，那么就暴力做吧

```python
class Solution:
    def angleClock(self, hour: int, minutes: int) -> float:
        hour %= 12
        result = abs((minutes * 6) - (hour * 30 + minutes * 0.5))
        return result if result < 360 else 360 - result
```

## 1345. Jump Game IV

题面：

> Given an array of integers arr, you are initially positioned at the first index of the array.
> In one step you can jump from index i to index:
> 1. i + 1 where: i + 1 < arr.length.
> 2. i - 1 where: i - 1 >= 0.
> 3. j where: arr[i] == arr[j] and i != j.
> Return the minimum number of steps to reach the last index of the array.
> Notice that you can not jump outside of the array at any time.

示例：

```text
Input: arr = [100,-23,-23,404,100,23,23,23,3,404]
Output: 3
Explanation: You need three jumps from index 0 --> 4 --> 3 --> 9. Note that index 9 is the last index of the array.
```

还是跳格子，给定一个数组，里面会有一些具体的值，现在从 index = 0 的地方起跳，跳跃规则如下：

1. 在 i+1 或 i-1 都在数组的范围内

2. 如果存在 index=j 且 arr[i]==arr[j] 且 i!=j 的时候，可以直接从 i 跳到 j

求从 index=0 跳到 index=arr.length-1 最小的次数

这题我还是没 A，后面琢磨了下，一个搜索的题目

1. 构建一个字典，值为key，index 为 value（相同的值之间可以直接跳）

2. 利用一个 set 来保存跳过的点

3. 从 index = 0 开始进行 BFS ，求每个点在一步之内可以跳到哪个点，然后不断的 BFS  直到到达终点

4. 更新被访问过的点

emmmm，好吧 BFS ，开写吧

```python
from typing import List, Set
import collections


class Solution:
    def minJumps(self, arr: List[int]) -> int:
        length = len(arr)
        if not arr or length == 1:
            return 0
        value_index = collections.defaultdict(list)
        for index, value in enumerate(arr):
            value_index[value].append(index)
        visited: Set[int] = set()
        traversal_queue = collections.deque([(0, 0)])
        result = 0
        while traversal_queue:
            next_step_queue = collections.deque()
            for _ in range(len(traversal_queue)):
                cur_index, cur_step = traversal_queue.popleft()
                cur_value = arr[cur_index]
                visited.add(cur_index)
                for next_index in [cur_index + 1, cur_index - 1] + value_index[
                    cur_value
                ]:
                    if (length > next_index >= 0) and (next_index not in visited):
                        if next_index == length - 2:
                            return cur_step + 2
                        if next_index == length - 1:
                            return cur_step + 1
                        next_step_queue.append((next_index, cur_step + 1))
                del value_index[cur_value]
            traversal_queue = next_step_queue
        return result
```

## 总结

这周的题，还是不难，但是需要小心，比如第二题我太大意直接暴力吃了一发T，然后第三题没仔细读题（求最小的度数）吃了一发 WA，不过和第二天周赛比起来，真的是幸福，175 第三题的题面直接让心态崩了，，明天写题解。

好了，滚去睡觉