---
title: Supervisor 的一个隐藏坑
type: tags
date: 2017-12-28 22:00:00
tags: [Python,编程,随笔,总结]
categories: [编程,Python]
---

本垃圾 API 搬运工程师又来了啊，= =今天因为 `Supervisor` 一个隐藏的参数配置，造成了一个重要项目的线上崩溃。= =我觉得还是有必要分享一波，所以写了一篇垃圾水文。

<!--more-->

## 起因

写着写着代码，突然接到一堆报警邮件，让我直接觉得世界不那么可爱

然后定睛一看异常信息？卧槽？新建连接就马上传说中的 `[Errno 24] Too many open files` ？？这搞你xxx啊，开始搞呗。

## 查 bug

首先，众所周知，Linux 中万物皆文件= =，于是我们操作网络链接的过程，其实也就是操作 `File Descriptor` 的问题= =，诶，既然 `Too many open files` 那就优先考虑，是不是系统设置的阀值太小了，于是 `ulimit -a` 一把梭？？

诶？`open files` 一栏数字不小啊？足够啊？那这特么是什么鬼啊？

行吧，查一下网络连接吧， 一把梭，`netstat -n | awk '/^tcp/ {++S[$NF]} END {for(a in S) print a, S[a]}'` 统计下，当时处于各个状态的连接数量吧

诶？有点意思，TIME_WAIT 数量太多了吧？诶？有意思，那就祭出老夫的内核网络参数的半吊子功夫，魔改一下呗？

~~~bash
#参数优化
#表示如果套接字由本端要求关闭，这个参数决定了它保持在FIN-WAIT-2状态的时间
net.ipv4.tcp_fin_timeout = 30
#表示当keepalive起用的时候，TCP发送keepalive消息的频度。缺省是2小时，改为300秒，
net.ipv4.tcp_keepalive_time = 300
#表示开启SYN Cookies。当出现SYN等待队列溢出时，启用cookies来处理，可防范少量SYN攻击，默认为0，表示关闭
net.ipv4.tcp_syncookies = 1
#表示如果套接字由本端要求关闭，这个参数决定了它保持在FIN-WAIT-2状态的时间
net.ipv4.tcp_tw_reuse = 1
#表示开启TCP连接中TIME-WAIT sockets的快速回收，默认为0，表示关闭，当前TIME-WAIT 过多，所以开启快速回收
net.ipv4.tcp_tw_recycle = 1
net.ipv4.ip_local_port_range = 5000 65000
~~~

在 `/etc/sysctl.conf` 中新增如上一些配置项。然后 `sysctl -p` 生效一波。开始看效果吧

诶！报错数量是在减小，TIME_WAIT 数量也逐渐正常

诶？？？等等？？？其余机器没 `TIME_WAIT` 过多的问题啊，那这尼玛是什么鬼？而且快速回收 `TIME_WAIT` 的连接也会带来其余的副作用（后面单章说）

= =好吧，现在怀疑，是不是 `Supervisor` 的问题，好的，文档翻阅大赛，开始

恩，，翻了半天，查到原因了，跟一个叫做 `minfds` 的参数相关

描述如下

> The minimum number of file descriptors that must be available before supervisord will start successfully. A call to setrlimit will be made to attempt to raise the soft and hard limits of the supervisord process to satisfy minfds. The hard limit may only be raised if supervisord is run as root. supervisord uses file descriptors liberally, and will enter a failure mode when one cannot be obtained from the OS, so it’s useful to be able to specify a minimum value to ensure it doesn’t run out of them during execution. These limits will be inherited by the managed subprocesses. This option is particularly useful on Solaris, which has a low per-process fd limit by default.

大意为，Supervisor 启动时，将根据 minfds 的值来确定系统中是否有足够的空余 fd 供其使用。同时因为我们跑在 Supervisor 中的服务，都是由 Supervisord fork 而来，因为父子关系，同时保证安全，单个进程开启的描述符最多不允许超过 minfds 设置的值，默认为 1024。然后，它补了一个刀，如果你用 root 用户运行的话，我们默认给你搞到系统最大的哦！

卧槽。。。原来是这啊，你谁没事用 root 跑服务啊= =简直药丸。。。

行吧，改参数，改参数

## 后续

最后这事就这样的结束了，趟一个雷，顺便复习了下内核的网络参数，虽然感觉美滋滋，不过感觉，贵 `Supervisor` 吃枣药丸！