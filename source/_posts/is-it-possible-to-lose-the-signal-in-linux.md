---
title: 子进程退出后，父进程有可能会收不到信号吗？
type: tags
date: 2023-08-10 22:09:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

最近工作强度有点大，写篇 Linux 相关的水文放松下

<!--more-->

这个问题实际上是来源于在群里和人的一个讨论。一个基本常识是，子进程退出后，父进程会收到 `SIGCHLD` 信号，然后父进程可以通过 `wait` 或者 `waitpid` 等系统调用来获取子进程的退出状态。那么，子进程退出后，父进程有可能会收不到信号吗？答案毫无疑问是 yes 的

本文就来聊个其中一个比较好理解的场景 BTW 本文代码都基于最新分支的 Linux 源码

## 正文

### 先来看一段代码

Fuck，哦不，Shut up，我们先来看一段代码

```python
import os
import time
import signal

count = 20
result = 0
print(os.getpid())
def sigc_handler(*args):
    global result
    result+=1
    os.waitpid(-1, 0)
    time.sleep(1)

def sig_int(*args):
    pass

def abc():
    for _ in range(count):
        if os.fork()==0:
            time.sleep(15)
            exit(0)
    while True:
        print(result)
        time.sleep(10)
signal.signal(signal.SIGCHLD, sigc_handler)

abc()
```

小学生级别的代码，那么这段代码我们预期是什么？很简单嘛对嘛，最后 result 和 count 相等。那么我们来看一下这段代码的执行结果

```text
root@kernel-dev-1:~/demo-script# python3 fork-demo.py 
33774
0
0
10
```

emmmm？？？？，然后我们发现机器上也出现了 Z 进程

![Z进程](https://github.com/Zheaoli/zheaoli.github.io/assets/7054676/d399f99a-9a69-4631-9800-8c8f4fe69e36)

为啥捏？这一切都是为啥捏

要聊清楚这个问题，就得从两方面入手

1. 进程退出后，内核里做了什么
2. 信号是怎么处理的

那就继续聊

### 进程退出后，内核里做了什么

进程退出后，内核核心的一个函数调用是 do_exit, 位于 `/kernel/exit.c`，看一下代码

```c
void __noreturn do_exit(long code)
{
...
	exit_signals(tsk);  /* sets PF_EXITING */

	/* sync mm's RSS info before statistics gathering */
	if (tsk->mm)
		sync_mm_rss(tsk->mm);
	acct_update_integrals(tsk);
	group_dead = atomic_dec_and_test(&tsk->signal->live);
	if (group_dead) {
		/*
		 * If the last thread of global init has exited, panic
		 * immediately to get a useable coredump.
		 */
		if (unlikely(is_global_init(tsk)))
			panic("Attempted to kill init! exitcode=0x%08x\n",
				tsk->signal->group_exit_code ?: (int)code);


		if (tsk->mm)
			setmax_mm_hiwater_rss(&tsk->signal->maxrss, tsk->mm);
	}
	acct_collect(code, group_dead);
	if (group_dead)
		tty_audit_exit();
	audit_free(tsk);

	tsk->exit_code = code;
	taskstats_exit(tsk, group_dead);

	exit_mm();

	if (group_dead)
		acct_process();
	trace_sched_process_exit(tsk);

	exit_sem(tsk);
	exit_shm(tsk);
	exit_files(tsk);
	exit_fs(tsk);
	if (group_dead)
		disassociate_ctty(1);
	exit_task_namespaces(tsk);
	exit_task_work(tsk);
	exit_thread(tsk);
    exit_notify(tsk, group_dead);
...
}
```

这段代码其实看着很轻松，基本上看调用函数名就能知道在干啥，比如 `exit_fs` 卸载文件系统啊，`exit_files` 清理关联文件啊，`exit_notify` 进行 reap 之类的操作啊，然后我们能一眼到一个函数 `exit_signals`，这个函数是干啥的呢？看一下代码

```c
void exit_signals(struct task_struct *tsk)
{
	int group_stop = 0;
	sigset_t unblocked;

	/*
	 * @tsk is about to have PF_EXITING set - lock out users which
	 * expect stable threadgroup.
	 */
	cgroup_threadgroup_change_begin(tsk);

	if (thread_group_empty(tsk) || (tsk->signal->flags & SIGNAL_GROUP_EXIT)) {
		sched_mm_cid_exit_signals(tsk);
		tsk->flags |= PF_EXITING;
		cgroup_threadgroup_change_end(tsk);
		return;
	}

	spin_lock_irq(&tsk->sighand->siglock);
	/*
	 * From now this task is not visible for group-wide signals,
	 * see wants_signal(), do_signal_stop().
	 */
	sched_mm_cid_exit_signals(tsk);
	tsk->flags |= PF_EXITING;

	cgroup_threadgroup_change_end(tsk);

	if (!task_sigpending(tsk))
		goto out;

	unblocked = tsk->blocked;
	signotset(&unblocked);
	retarget_shared_pending(tsk, &unblocked);

	if (unlikely(tsk->jobctl & JOBCTL_STOP_PENDING) &&
	    task_participate_group_stop(tsk))
		group_stop = CLD_STOPPED;
out:
	spin_unlock_irq(&tsk->sighand->siglock);

	/*
	 * If group stop has completed, deliver the notification.  This
	 * should always go to the real parent of the group leader.
	 */
	if (unlikely(group_stop)) {
		read_lock(&tasklist_lock);
		do_notify_parent_cldstop(tsk, false, group_stop);
		read_unlock(&tasklist_lock);
	}
}
```

其实前面都是一些准备操作，比如加锁准备操作，cgroup 的前置操作啊，在这些完成后，`do_notify_parent_cldstop` 将是我们最终执行信号发送的地方，看一下代码

```c
static void do_notify_parent_cldstop(struct task_struct *tsk,
				     bool for_ptracer, int why)
{
	struct kernel_siginfo info;
	unsigned long flags;
	struct task_struct *parent;
	struct sighand_struct *sighand;
	u64 utime, stime;

	if (for_ptracer) {
		parent = tsk->parent;
	} else {
		tsk = tsk->group_leader;
		parent = tsk->real_parent;
	}

	clear_siginfo(&info);
	info.si_signo = SIGCHLD;
	info.si_errno = 0;
	/*
	 * see comment in do_notify_parent() about the following 4 lines
	 */
	rcu_read_lock();
	info.si_pid = task_pid_nr_ns(tsk, task_active_pid_ns(parent));
	info.si_uid = from_kuid_munged(task_cred_xxx(parent, user_ns), task_uid(tsk));
	rcu_read_unlock();

	task_cputime(tsk, &utime, &stime);
	info.si_utime = nsec_to_clock_t(utime);
	info.si_stime = nsec_to_clock_t(stime);

 	info.si_code = why;
 	switch (why) {
 	case CLD_CONTINUED:
 		info.si_status = SIGCONT;
 		break;
 	case CLD_STOPPED:
 		info.si_status = tsk->signal->group_exit_code & 0x7f;
 		break;
 	case CLD_TRAPPED:
 		info.si_status = tsk->exit_code & 0x7f;
 		break;
 	default:
 		BUG();
 	}

	sighand = parent->sighand;
	spin_lock_irqsave(&sighand->siglock, flags);
	if (sighand->action[SIGCHLD-1].sa.sa_handler != SIG_IGN &&
	    !(sighand->action[SIGCHLD-1].sa.sa_flags & SA_NOCLDSTOP))
		send_signal_locked(SIGCHLD, &info, parent, PIDTYPE_TGID);
	/*
	 * Even if SIGCHLD is not generated, we must wake up wait4 calls.
	 */
	__wake_up_parent(tsk, parent);
	spin_unlock_irqrestore(&sighand->siglock, flags);
}
```

这个函数稍晚有点长，我们依次来解析下

```c
	if (for_ptracer) {
		parent = tsk->parent;
	} else {
		tsk = tsk->group_leader;
		parent = tsk->real_parent;
	}
```

通过 task_struct 的定义，查找父进程，准备下面的操作

```c
	clear_siginfo(&info);
	info.si_signo = SIGCHLD;
	info.si_errno = 0;
```

设置 info 中的信号为 SIGCHLD

```c
if (sighand->action[SIGCHLD-1].sa.sa_handler != SIG_IGN &&
	    !(sighand->action[SIGCHLD-1].sa.sa_flags & SA_NOCLDSTOP))
		send_signal_locked(SIGCHLD, &info, parent, PIDTYPE_TGID);
	/*
	 * Even if SIGCHLD is not generated, we must wake up wait4 calls.
	 */
	__wake_up_parent(tsk, parent);
	spin_unlock_irqrestore(&sighand->siglock, flags);
```

发送信号，然后唤醒父进程，最后释放锁。

现在我们差不多搞清楚了在进程退出时，内核怎么发信号的。

但是一个问题还是没解决，为什么在我们的 case 里有信号没拿到？

那么接着聊

### 信号是怎么处理的

花开两朵，各表一支，我们上文看到，最后我们在进程回收的时候，调用 `send_signal_locked` 发送信号。在继续聊这个问题之前，我们需要来了解一些简单的 Linux 信号的知识

在 Linux 中，Linux 将进程分为了 real-time 和 standard 信号。后者通常又有一个别名叫作不可靠信号。通常来讲，信号值小于 SIGTMIN 的为不可靠信号，信号值大于 SIGTMIN 的为 RT 信号。Linux 对于 RT 信号的特性有如下描述

> 1. Multiple instances of real-time signals can be queued.  By contrast, if multiple instances of a standard signal are delivered while that signal is currently blocked, then only one instance is queued.
> 2. If the signal is sent using sigqueue(3), an accompanying value (either an integer or a pointer) can be sent with the signal. If the receiving process establishes a handler for this signal using the SA_SIGINFO flag to sigaction(2), then it can obtain this data via the si_value field of the siginfo_t structure passed as the second argument to the handler.  Furthermore, the si_pid and si_uid fields of this structure can be used to obtain the PID and real user ID of the process sending the signal.
> 3. Real-time signals are delivered in a guaranteed order. Multiple real-time signals of the same type are delivered in the order they were sent.  If different real-time signals are sent to a process, they are delivered starting with the lowest-numbered signal.  (I.e., low-numbered signals have highest priority.)  By contrast, if multiple standard signals are pending for a process, the order in which they are delivered is unspecified.

简单来说，RT 信号是可靠且有序的，在内核中，task 的解构包含了两个关键结构体

```c
struct sigpending {
	struct list_head list;
	sigset_t signal;
};

struct sigqueue {
	struct list_head list;
	int flags;
	kernel_siginfo_t info;
	struct ucounts *ucounts;
};

```

很明显，这两个结构体是内存中的链表，sigpending 中的 sigset_t signal 是个 64位整数，每个结构体占据一位，标注是否有信号触发。

我们来看下=`send_signal_locked` 的代码

```c
int send_signal_locked(int sig, struct kernel_siginfo *info,
		       struct task_struct *t, enum pid_type type)
{
	/* Should SIGKILL or SIGSTOP be received by a pid namespace init? */
	bool force = false;

	if (info == SEND_SIG_NOINFO) {
		/* Force if sent from an ancestor pid namespace */
		force = !task_pid_nr_ns(current, task_active_pid_ns(t));
	} else if (info == SEND_SIG_PRIV) {
		/* Don't ignore kernel generated signals */
		force = true;
	} else if (has_si_pid_and_uid(info)) {
		/* SIGKILL and SIGSTOP is special or has ids */
		struct user_namespace *t_user_ns;

		rcu_read_lock();
		t_user_ns = task_cred_xxx(t, user_ns);
		if (current_user_ns() != t_user_ns) {
			kuid_t uid = make_kuid(current_user_ns(), info->si_uid);
			info->si_uid = from_kuid_munged(t_user_ns, uid);
		}
		rcu_read_unlock();

		/* A kernel generated signal? */
		force = (info->si_code == SI_KERNEL);

		/* From an ancestor pid namespace? */
		if (!task_pid_nr_ns(current, task_active_pid_ns(t))) {
			info->si_pid = 0;
			force = true;
		}
	}
	return __send_signal_locked(sig, info, t, type, force);
}
```

前面又是一堆准备操作，我们直接把目光转向 `__send_signal_locked` 函数

```c
static int __send_signal_locked(int sig, struct kernel_siginfo *info,
				struct task_struct *t, enum pid_type type, bool force)
{
	struct sigpending *pending;
	struct sigqueue *q;
	int override_rlimit;
	int ret = 0, result;

	lockdep_assert_held(&t->sighand->siglock);

	result = TRACE_SIGNAL_IGNORED;
	if (!prepare_signal(sig, t, force))
		goto ret;

	pending = (type != PIDTYPE_PID) ? &t->signal->shared_pending : &t->pending;
	/*
	 * Short-circuit ignored signals and support queuing
	 * exactly one non-rt signal, so that we can get more
	 * detailed information about the cause of the signal.
	 */
	result = TRACE_SIGNAL_ALREADY_PENDING;
	if (legacy_queue(pending, sig))
		goto ret;

	result = TRACE_SIGNAL_DELIVERED;
	/*
	 * Skip useless siginfo allocation for SIGKILL and kernel threads.
	 */
	if ((sig == SIGKILL) || (t->flags & PF_KTHREAD))
		goto out_set;

	/*
	 * Real-time signals must be queued if sent by sigqueue, or
	 * some other real-time mechanism.  It is implementation
	 * defined whether kill() does so.  We attempt to do so, on
	 * the principle of least surprise, but since kill is not
	 * allowed to fail with EAGAIN when low on memory we just
	 * make sure at least one signal gets delivered and don't
	 * pass on the info struct.
	 */
	if (sig < SIGRTMIN)
		override_rlimit = (is_si_special(info) || info->si_code >= 0);
	else
		override_rlimit = 0;

	q = __sigqueue_alloc(sig, t, GFP_ATOMIC, override_rlimit, 0);

	if (q) {
		list_add_tail(&q->list, &pending->list);
		switch ((unsigned long) info) {
		case (unsigned long) SEND_SIG_NOINFO:
			clear_siginfo(&q->info);
			q->info.si_signo = sig;
			q->info.si_errno = 0;
			q->info.si_code = SI_USER;
			q->info.si_pid = task_tgid_nr_ns(current,
							task_active_pid_ns(t));
			rcu_read_lock();
			q->info.si_uid =
				from_kuid_munged(task_cred_xxx(t, user_ns),
						 current_uid());
			rcu_read_unlock();
			break;
		case (unsigned long) SEND_SIG_PRIV:
			clear_siginfo(&q->info);
			q->info.si_signo = sig;
			q->info.si_errno = 0;
			q->info.si_code = SI_KERNEL;
			q->info.si_pid = 0;
			q->info.si_uid = 0;
			break;
		default:
			copy_siginfo(&q->info, info);
			break;
		}
	} else if (!is_si_special(info) &&
		   sig >= SIGRTMIN && info->si_code != SI_USER) {
		/*
		 * Queue overflow, abort.  We may abort if the
		 * signal was rt and sent by user using something
		 * other than kill().
		 */
		result = TRACE_SIGNAL_OVERFLOW_FAIL;
		ret = -EAGAIN;
		goto ret;
	} else {
		/*
		 * This is a silent loss of information.  We still
		 * send the signal, but the *info bits are lost.
		 */
		result = TRACE_SIGNAL_LOSE_INFO;
	}

out_set:
	signalfd_notify(t, sig);
	sigaddset(&pending->signal, sig);

	/* Let multiprocess signals appear after on-going forks */
	if (type > PIDTYPE_TGID) {
		struct multiprocess_signals *delayed;
		hlist_for_each_entry(delayed, &t->signal->multiprocess, node) {
			sigset_t *signal = &delayed->signal;
			/* Can't queue both a stop and a continue signal */
			if (sig == SIGCONT)
				sigdelsetmask(signal, SIG_KERNEL_STOP_MASK);
			else if (sig_kernel_stop(sig))
				sigdelset(signal, SIGCONT);
			sigaddset(signal, sig);
		}
	}

	complete_signal(sig, t, type);
ret:
	trace_signal_generate(sig, info, t, type != PIDTYPE_PID, result);
	return ret;
}
```

这里我们核心关注这样一些地方

```c
if (legacy_queue(pending, sig))
		goto ret;
```

这里是判断当前发送的信号，是否已经在 sigpending 中的 sigset_t signal 中注册，如果注册了，就直接进入返回流程

```c
static inline bool legacy_queue(struct sigpending *signals, int sig)
{
	return (sig < SIGRTMIN) && sigismember(&signals->signal, sig);
}
```

嗯这段逻辑就很清晰了，继续回到 `__send_signal_locked` 函数

```c
	if (sig < SIGRTMIN)
		override_rlimit = (is_si_special(info) || info->si_code >= 0);
	else
		override_rlimit = 0;

	q = __sigqueue_alloc(sig, t, GFP_ATOMIC, override_rlimit, 0);

	if (q) {
        ...
```

这里判断是否需要强制超出系统 SIGNAL QUEUE 的长度限制，然后调用 `__sigqueue_alloc` 函数，这个函数的作用是分配一个 sigqueue 结构体，然后将其加入到 sigpending 的链表中

```c
static struct sigqueue *
__sigqueue_alloc(int sig, struct task_struct *t, gfp_t gfp_flags,
		 int override_rlimit, const unsigned int sigqueue_flags)
{
	struct sigqueue *q = NULL;
	struct ucounts *ucounts = NULL;
	long sigpending;

	/*
	 * Protect access to @t credentials. This can go away when all
	 * callers hold rcu read lock.
	 *
	 * NOTE! A pending signal will hold on to the user refcount,
	 * and we get/put the refcount only when the sigpending count
	 * changes from/to zero.
	 */
	rcu_read_lock();
	ucounts = task_ucounts(t);
	sigpending = inc_rlimit_get_ucounts(ucounts, UCOUNT_RLIMIT_SIGPENDING);
	rcu_read_unlock();
	if (!sigpending)
		return NULL;

	if (override_rlimit || likely(sigpending <= task_rlimit(t, RLIMIT_SIGPENDING))) {
		q = kmem_cache_alloc(sigqueue_cachep, gfp_flags);
	} else {
		print_dropped_signal(sig);
	}

	if (unlikely(q == NULL)) {
		dec_rlimit_put_ucounts(ucounts, UCOUNT_RLIMIT_SIGPENDING);
	} else {
		INIT_LIST_HEAD(&q->list);
		q->flags = sigqueue_flags;
		q->ucounts = ucounts;
	}
	return q;
}
```

这里的逻辑就很清晰了，分配内存，返回指针。这里系统中 RLIMIT_SIGPENDING 的配置决定了我们 pending 队列的长度。各个发行版不同

差不多这样

### 总结

回到我们最开始的代码

```python
import os
import time
import signal

count = 20
result = 0
print(os.getpid())
def sigc_handler(*args):
    global result
    result+=1
    os.waitpid(-1, 0)
    time.sleep(1)

def sig_int(*args):
    pass

def abc():
    for _ in range(count):
        if os.fork()==0:
            time.sleep(15)
            exit(0)
    while True:
        print(result)
        time.sleep(10)
signal.signal(signal.SIGCHLD, sigc_handler)

abc()
```

这段代码，在我们的回调函数中存在 block 行为，导致后续进程在 SIGCHLD 信号发送后，在 `legacy_queue` 处判断当前队列有同样的非可靠信号未被处理完，于是没有完成后续的信号处理流程

嗯，差不多就这样。简单写篇入门水文，希望大家看的开心
