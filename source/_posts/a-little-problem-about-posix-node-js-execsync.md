---
title: 关于 Node.js 中 execSync 的一点问题
type: tags
date: 2021-08-24 21:00:00
tags: [编程,Linux,Node.js,笔记,水文]
categories: [编程,Linux]
toc: true
---

很久没写水文了，昨天帮人查了一个 Node.js 中 `execSync` 这个函数特殊行为的问题，很有趣，所以大概记录下来水一篇文章

<!--more-->

## 背景

首先老哥给了一张截图

![问题截图](https://user-images.githubusercontent.com/7054676/130622339-57e6a954-926e-4741-93a9-bc1ba0d155d8.png)

首先基本问题可以抽象为在 Node.js 中利用 `execSync` 这个函数执行 `ps -Af | grep -q -E -c "\\-\\-user-data-dir=\\.+App"` 这样一条命令的时候，Node.js 时不时会报错。具体堆栈大概为

```text
Uncaught Error: Command failed: ps -Af | grep -q -E -c "\-\-user-data-dir=\.+App"
    at checkExecSyncError (child_process.js:616:11)
    at Object.execSync (child_process.js:652:15) {
  status: 1,
  signal: null,
  output: [ null, <Buffer >, <Buffer > ],
  pid: 89073,
  stdout: <Buffer >,
  stderr: <Buffer >
}
```

但是同样的命令在终端上并不会有类似的现象。所以这个问题有点困扰人

## 分析

首先先看一下 Node.js 文档中对 `execSync` 的描述

> The child_process.execSync() method is generally identical to child_process.exec() with the exception that the method will not return until the child process has fully closed. When a timeout has been encountered and killSignal is sent, the method won't return until the process has completely exited. If the child process intercepts and handles the SIGTERM signal and doesn't exit, the parent process will wait until the child process has exited.
> If the process times out or has a non-zero exit code, this method will throw. The Error object will contain the entire result from child_process.spawnSync().
> Never pass unsanitized user input to this function. Any input containing shell metacharacters may be used to trigger arbitrary command execution.

大意就是，这个函数通过子进程来执行一个命令，在命令执行超时之前会一直等待。OK 没有问题。那接下来，我们先来看一下上面提到的报错堆栈以及 `execSync` 的实现代码

```javascript
function execSync(command, options) {
  const opts = normalizeExecArgs(command, options, null);
  const inheritStderr = !opts.options.stdio;

  const ret = spawnSync(opts.file, opts.options);

  if (inheritStderr && ret.stderr)
    process.stderr.write(ret.stderr);

  const err = checkExecSyncError(ret, opts.args, command);

  if (err)
    throw err;

  return ret.stdout;
}

function checkExecSyncError(ret, args, cmd) {
  let err;
  if (ret.error) {
    err = ret.error;
  } else if (ret.status !== 0) {
    let msg = 'Command failed: ';
    msg += cmd || ArrayPrototypeJoin(args, ' ');
    if (ret.stderr && ret.stderr.length > 0)
      msg += `\n${ret.stderr.toString()}`;
    // eslint-disable-next-line no-restricted-syntax
    err = new Error(msg);
  }
  if (err) {
    ObjectAssign(err, ret);
  }
  return err;
}
```

我们能看到，这里 `execSync` 在执行完命令执行代码后，会进入 `checkExecSyncError` 来检查子进程的 `Exit Status Code` 是否为0，不为0则认为命令执行出错，然后抛出异常。

看起来没有问题，那么也就是我们执行命令的时候出错了？那我们验证下吧

对于这种涉及 Linux 下 Syscall 问题排查的工具（这个问题在 Mac 等环境下也存在，不过我为了方便排查，跑去 Linux 上复现了），除了 `strace` 好像也暂时找不到更成熟方便的工具了（虽然基于 eBPF 也能做，但是说实话自己现撸绝对没 `strace` 的效果好。

那么上命令

```bash
sudo strace -t -f -p $PID -o error_trace.txt
```

> tips: 在使用 strace 的时候可以利用 -f 参数，可以 trace 被 trace 进程创建的子进程

好了执行命令，成功拿到整个 syscall 的调用链路，OK 开始分析

首先我们将目光很快定位到了最关键的部分（因为整个文件太长，有将近 4K 行，我就直接挑重点部分分析了）

```text
...
894259 13:21:23 clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f12d9465a50) = 896940
...
896940 13:21:23 execve("/bin/sh", ["/bin/sh", "-c", "ps -Af | grep -E -c \"\\-\\-user-da"...], 0x4aae230 /* 40 vars */ <unfinished ...>
...
896940 13:21:24 <... wait4 resumed>[{WIFEXITED(s) && WEXITSTATUS(s) == 1}], 0, NULL) = 896942
896940 13:21:24 --- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=896942, si_uid=1000, si_status=1, si_utime=0, si_stime=0} ---
896940 13:21:24 rt_sigreturn({mask=[]}) = 896942
896940 13:21:24 exit_group(1)           = ?
896940 13:21:24 +++ exited with 1 +++
```

首先这里科普一下，Node.js 中没有直接使用 `fork` 来创建新的进程，而是使用 `clone` 来创建新的进程，至于两者之间的差别，要详细说的话，可以单独水一篇超长文了（我先立个 flag）这里先用官方的说法大概描述下

> These system calls create a new ("child") process, in a manner similar to fork(2).
> By contrast with fork(2), these system calls provide more precise control over what pieces of execution context are shared between the calling process and the child process.  For example, using these system calls, the caller can control whether or not the two processes share the virtual address space, the table of file descriptors, and the table of signal handlers.  These system calls also allow the new child process to be placed in separate namespaces(7).

用简短的概括性的话来描述就是,`clone` 提供了 `fork` 近似的语义,不过通过 `clone` ,开发者能更细粒度的控制进程/线程创建过程中的细节

OK, 这里我们看到 `894259` 这个主进程通过 `clone` 创建了 `896940` 这个进程。在执行过程中, `896940` 这个进程利用 `execve` 这个 syscall 通过 sh (这是 `execSync` 的默认行为)我们的命令 `ps -Af | grep -q -E -c "\\-\\-user-data-dir=\\.+App"`。 OK，我们也看到了，`896940` 在退出的时候，的确是以 1 的 exit code 退出的，和我们之前的分析一致。那么换句话说，在我们执行命令的时候，有 error 的出现。那么这里的 error 出现在哪呢？

我们分析一下命令，如果熟悉常见 shell 的同学可能发现了，我们的命令中实际上使用了管道操作符 | ，不精确的来说，当这个操作符出现的时候，前后两个命令将分别在两个进程执行，然后通过 pipe 进行 IPC。那么换句话说，我们可以很快定位这两个进程，直接快速搜了一下文本

```text
...
896941 13:21:23 execve("/bin/ps", ["ps", "-Af"], 0x564c16f6ec38 /* 40 vars */) = 0
...
896942 13:21:23 execve("/bin/grep", ["grep", "-E", "-c", "\\-\\-user-data-dir=\\.*"], 0x564c16f6ecb0 /* 40 vars */ <unfinished ...>
...
896941 13:21:24 <... exit_group resumed>) = ?
896941 13:21:24 +++ exited with 0 +++
...
896942 13:21:24 exit_group(1)           = ?
896942 13:21:24 +++ exited with 1 +++
```

OK，我们发现 `896942` 即执行 `grep` 的进程直接以 exit code 1 退出了。那么这是为什么呢？？看了下 `grep` 的官方文档，，卧操，差点吐血

> Normally, the exit status is 0 if selected lines are found and 1 otherwise. But the exit status is 2 if an error occurred, unless the -q or --quiet or --silent option is used and a selected line is found. Note, however, that POSIX only mandates, for programs such as grep, cmp, and diff, that the exit status in case of error be greater than 1; it is therefore advisable, for the sake of portability, to use logic that tests for this general condition instead of strict equality with 2.

如果 grep 没有匹配到数据，那么会以 1 作为 exit code 退出进程。。如果匹配到了，则0退出。。但是，但是，卧操，卧操。。按照标准语义，exit code 1 的含义难道不是 `Operation not permitted` 吗？？完全不按基本法出牌！

## 总结

实际上通篇看了下来，我们可以总结出两个原因

1. Node.js 在对 POSIX 相关 API 进行抽象封装的时候，直接按照了标准语义，给用户兜底了。虽然从理论上讲这应该是个应用自决的行为
2. grep 没有按照基本法办事

说实话我也不知道怎么去评价这两方面谁更坑一点。按照前面所说么处理子进程的 exit code 从理论上讲这应该是个应用自决的行为，但是 Node.js 自己做了一层封装，在节省用户心智的同时，遇到一些非标场景，也会有不小的隐患了。。

只能说不断根据不同的场景做 trade-off 吧

好了，这篇文章就到这里了，因为是临时起义，所以我就懒得将相关 Reference 列在文里了。差不多这样吧，水文目标达成.jpg
