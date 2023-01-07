---
title: 排查一个特殊的 No space left on device
type: tags
date: 2023-01-07 23:30:00
tags: [编程,Linux,容器]
categories: [编程,Linux]
toc: true
---

好久没写水文了，新年第一篇水文总得写一下，完成下 OKR，正好最近帮群友查了一个特殊的 No space left on device 问题，记录一下。

<!--more-->

## 问题

半夜接到群友求助，说自己的测试环境遇到了点问题，正好我还没睡，那就来看一下

问题的情况很简单，

> 用 `docker run -d  --env-file .oss_env --mount type=bind,src=/data1,dst=/cache {image}` 启动了一个容器，然后发现在启动后业务代码报错，抛出 **OSError: [Errno 28] No space left on device** 的异常

这个问题其实很典型，但是最终排查出来的结果确实非典型的。不过排查思路其实应该是很典型的线上问题的一步步分析 root casue 的过程。希望能对看官就帮助

## 排查

首先群友提供了第一个关键信息，空间有余量，但是就 **OSError: [Errno 28] No space left on device** 。那么熟悉 Linux 的同学可能第一步的排查工作就是排查对应的 inode 情况

执行命令

```bash
df -ih
```

![inode](https://user-images.githubusercontent.com/7054676/211155731-c54b1146-2daa-48b3-8e1e-294040d73201.png)

我们能看到 /data1 实际上的 inode 和整机的 inode 数量都是足够的（备注：这里是我自己在我自己的机器上复现问题的截图，第一步由群友完成，然后给我提供了信息）

那么我们继续排查，我们看到了我们使用了 [mount bind<sup>1</sup>](#refer-anchor-1) 的方式将宿主机的 /data1 挂载到了容器内部的 /cache 目录下, mount bind 可以用下面一张图来表示和 volume 的区别

![mount bind](https://docs.docker.com/storage/images/types-of-mounts-bind.png)

都在不同版本的内核上，mount bind 的行为有一些特殊的情况，所以我们需要确认下 mount bind 的情况是否正确，我们用 [fallocate<sup>2</sup>](#refer-anchor-2) 来创建一个 1G 的文件，然后在容器内部查看文件的大小

```bash
fallocate -l 10G /cache/test
```

文件创建没有问题，实际上我们就可以排除掉 mount bind 的缺陷了

接着，群友提供了这个盘是云厂商的云盘（经过扩容），我让群友确认下是具体的 ESSD 还是 NAS 这种走 NFS 挂载的 Block Device（这块也有坑）。确认是标准的 ESSD 后进入下一步（驱动的问题可以先排除）

接着，我们需要考虑 mount --bind 在跨文件系统情况下的问题。虽然前面一步我们成功创建了文件。但是为了保险起见，我们执行 `fdisk -l` 和 `tune2fs -l` 两个命令，来确认分区和文件系统的正确性，确认文件系统的类型都是 ext4，那么没有问题。具体两个命令的使用方式参见 [fdisk<sup>3</sup>](#refer-anchor-3) 和 [tune2fs<sup>4</sup>](#refer-anchor-4)

然后再回顾我们之前直接在 `/cache` 下创建问题没有问题，那么这个时候我们心里应该大概有底，这个应该不是代码问题，也不是权限问题（这一步我额外排除镜像的构建里没有额外的用户操作），那么我们需要排除一下扩容的问题。我们将 /data1 unmount 之后，重新 mount 后，再执行容器，发现问题依旧存在，那么我们就可以去排除扩容的问题了。

现在一些常见的问题已经基本排除，那么我们来考虑文件系统本身的问题。我登录到机器上，执行了以下两个操作

1. 在出问题的目录 `/cache/xxx/` 下，我用 `fallocate -l` 创建一个报错的文件（长文件名），失败
2. 在出问题的目录 `/cache/xxx/` 下，我用 ``fallocate -l`` 创建一个短文件名），成功 

OK，我们现在排查路径就往文件系统异常的方向上靠了，执行命令 [dmesg<sup>5</sup>](#refer-anchor-5) 查看内核日志，发现了如下错误

```text
[13155344.231942] EXT4-fs warning (device sdd): ext4_dx_add_entry:2461: Directory (ino: 3145729) index full, reach max htree level :2
[13155344.231944] EXT4-fs warning (device sdd): ext4_dx_add_entry:2465: Large directory feature is not enabled on this filesystem
```

OK，我们期待的异常信息找到了。原因是，ext4 基于的 BTree 索引，默认情况下只允许树的层高为2，实际上就大概限制了目录下的文件数量大概在 2k-3kw 以内。经过确认，这个问题目录下的确有大量小文件。我们再用 `tune2fs -l` 确认下是否是如我们猜想，得到结果

```text
Filesystem revision #:    1 (dynamic)
Filesystem features:      has_journal ext_attr resize_inode dir_index filetype needs_recovery extent 64bit flex_bg sparse_super large_file huge_file dir_nlink extra_isize metadata_csum
Filesystem flags:         signed_directory_hash
```

bingo，的确没有开启 `large_dir` 的选项。那么我们执行 `tune2fs -O large_dir /dev/sdd` 开启这个选项，然后再次执行 `tune2fs -l` 确认下，发现已经开启了。然后我们再次执行容器，发现问题已经解决。

## 验证

上面的问题排查看似告一段落。但是实际上并没有闭环。一个问题的闭环有两个特征

1. 定位到具体的异常代码
2. 有最小可复现版本确认我们找到 root cause 是符合预期的。

从上面 dmesg 的信息我们能定位到内核中的函数，其实现如下

```c
static int ext4_dx_add_entry(handle_t *handle, struct ext4_filename *fname,
			     struct inode *dir, struct inode *inode)
{
	struct dx_frame frames[EXT4_HTREE_LEVEL], *frame;
	struct dx_entry *entries, *at;
	struct buffer_head *bh;
	struct super_block *sb = dir->i_sb;
	struct ext4_dir_entry_2 *de;
	int restart;
	int err;

again:
	restart = 0;
	frame = dx_probe(fname, dir, NULL, frames);
	if (IS_ERR(frame))
		return PTR_ERR(frame);
	entries = frame->entries;
	at = frame->at;
	bh = ext4_read_dirblock(dir, dx_get_block(frame->at), DIRENT_HTREE);
	if (IS_ERR(bh)) {
		err = PTR_ERR(bh);
		bh = NULL;
		goto cleanup;
	}

	BUFFER_TRACE(bh, "get_write_access");
	err = ext4_journal_get_write_access(handle, sb, bh, EXT4_JTR_NONE);
	if (err)
		goto journal_error;

	err = add_dirent_to_buf(handle, fname, dir, inode, NULL, bh);
	if (err != -ENOSPC)
		goto cleanup;

	err = 0;
	/* Block full, should compress but for now just split */
	dxtrace(printk(KERN_DEBUG "using %u of %u node entries\n",
		       dx_get_count(entries), dx_get_limit(entries)));
	/* Need to split index? */
	if (dx_get_count(entries) == dx_get_limit(entries)) {
		ext4_lblk_t newblock;
		int levels = frame - frames + 1;
		unsigned int icount;
		int add_level = 1;
		struct dx_entry *entries2;
		struct dx_node *node2;
		struct buffer_head *bh2;

		while (frame > frames) {
			if (dx_get_count((frame - 1)->entries) <
			    dx_get_limit((frame - 1)->entries)) {
				add_level = 0;
				break;
			}
			frame--; /* split higher index block */
			at = frame->at;
			entries = frame->entries;
			restart = 1;
		}
		if (add_level && levels == ext4_dir_htree_level(sb)) {
			ext4_warning(sb, "Directory (ino: %lu) index full, "
					 "reach max htree level :%d",
					 dir->i_ino, levels);
			if (ext4_dir_htree_level(sb) < EXT4_HTREE_LEVEL) {
				ext4_warning(sb, "Large directory feature is "
						 "not enabled on this "
						 "filesystem");
			}
			err = -ENOSPC;
			goto cleanup;
		}
		icount = dx_get_count(entries);
		bh2 = ext4_append(handle, dir, &newblock);
		if (IS_ERR(bh2)) {
			err = PTR_ERR(bh2);
			goto cleanup;
		}
		node2 = (struct dx_node *)(bh2->b_data);
		entries2 = node2->entries;
		memset(&node2->fake, 0, sizeof(struct fake_dirent));
		node2->fake.rec_len = ext4_rec_len_to_disk(sb->s_blocksize,
							   sb->s_blocksize);
		BUFFER_TRACE(frame->bh, "get_write_access");
		err = ext4_journal_get_write_access(handle, sb, frame->bh,
						    EXT4_JTR_NONE);
		if (err)
			goto journal_error;
		if (!add_level) {
			unsigned icount1 = icount/2, icount2 = icount - icount1;
			unsigned hash2 = dx_get_hash(entries + icount1);
			dxtrace(printk(KERN_DEBUG "Split index %i/%i\n",
				       icount1, icount2));

			BUFFER_TRACE(frame->bh, "get_write_access"); /* index root */
			err = ext4_journal_get_write_access(handle, sb,
							    (frame - 1)->bh,
							    EXT4_JTR_NONE);
			if (err)
				goto journal_error;

			memcpy((char *) entries2, (char *) (entries + icount1),
			       icount2 * sizeof(struct dx_entry));
			dx_set_count(entries, icount1);
			dx_set_count(entries2, icount2);
			dx_set_limit(entries2, dx_node_limit(dir));

			/* Which index block gets the new entry? */
			if (at - entries >= icount1) {
				frame->at = at - entries - icount1 + entries2;
				frame->entries = entries = entries2;
				swap(frame->bh, bh2);
			}
			dx_insert_block((frame - 1), hash2, newblock);
			dxtrace(dx_show_index("node", frame->entries));
			dxtrace(dx_show_index("node",
			       ((struct dx_node *) bh2->b_data)->entries));
			err = ext4_handle_dirty_dx_node(handle, dir, bh2);
			if (err)
				goto journal_error;
			brelse (bh2);
			err = ext4_handle_dirty_dx_node(handle, dir,
						   (frame - 1)->bh);
			if (err)
				goto journal_error;
			err = ext4_handle_dirty_dx_node(handle, dir,
							frame->bh);
			if (restart || err)
				goto journal_error;
		} else {
			struct dx_root *dxroot;
			memcpy((char *) entries2, (char *) entries,
			       icount * sizeof(struct dx_entry));
			dx_set_limit(entries2, dx_node_limit(dir));

			/* Set up root */
			dx_set_count(entries, 1);
			dx_set_block(entries + 0, newblock);
			dxroot = (struct dx_root *)frames[0].bh->b_data;
			dxroot->info.indirect_levels += 1;
			dxtrace(printk(KERN_DEBUG
				       "Creating %d level index...\n",
				       dxroot->info.indirect_levels));
			err = ext4_handle_dirty_dx_node(handle, dir, frame->bh);
			if (err)
				goto journal_error;
			err = ext4_handle_dirty_dx_node(handle, dir, bh2);
			brelse(bh2);
			restart = 1;
			goto journal_error;
		}
	}
	de = do_split(handle, dir, &bh, frame, &fname->hinfo);
	if (IS_ERR(de)) {
		err = PTR_ERR(de);
		goto cleanup;
	}
	err = add_dirent_to_buf(handle, fname, dir, inode, de, bh);
	goto cleanup;

journal_error:
	ext4_std_error(dir->i_sb, err); /* this is a no-op if err == 0 */
cleanup:
	brelse(bh);
	dx_release(frames);
	/* @restart is true means htree-path has been changed, we need to
	 * repeat dx_probe() to find out valid htree-path
	 */
	if (restart && err == 0)
		goto again;
	return err;
}
```

`ext4_dx_add_entry` 函数的主要功能是将新的目录项添加到目录索引中，我们能看到这段函数在 `add_level && levels == ext4_dir_htree_level(sb)` 这里检查对应的特性是否打开，以及当前 BTree 层高，如果超出限制，则返回 `ENOSPC` 即 ERROR 28

好了，在复现异常之前，我们来获取下这个函数的被调用路径。这里我用 eBPF 的 trace 来获取 stacktrace，因为与主体无关，我在这里就不放代码了

```text
  ext4_dx_add_entry
  ext4_add_nondir
  ext4_create
  path_openat
  do_filp_open
  do_sys_openat2
  do_sys_open
  __x64_sys_openat
  do_syscall_64
  entry_SYSCALL_64_after_hwframe
  [unknown]
  [unknown]
```

那么我们怎么验证这个是我们的异常呢

首先我们利用 eBPF + kretproble 来获取 `ext4_dx_add_entry` 的返回值，如果返回值是 `ENOSPC`，则我们就可以确定这个是我们的异常

代码如下（不要问我这里为啥不用 Python 写，要写 C 了（

```python
from bcc import BPF

bpf_text = """
#include <uapi/linux/ptrace.h>
BPF_RINGBUF_OUTPUT(events, 65536);

struct event_data_t {
    u32 pid;
};

int trace_ext4_dx_add_entry_return(struct pt_regs *ctx) {
    int ret = PT_REGS_RC(ctx);
    if (ret == 0) {
        return 0;
    }
    u32 pid=bpf_get_current_pid_tgid()>>32;
    struct event_data_t *event_data = events.ringbuf_reserve(sizeof(struct event_data_t));
    if (!event_data) {
        return 0;
    }
    event_data->pid = pid;
    events.ringbuf_submit(event_data, sizeof(event_data));
    return 0;
}
"""


bpf = BPF(text=bpf_text)

bpf.attach_kretprobe(event="ext4_dx_add_entry", fn_name="trace_ext4_dx_add_entry_return")

def process_event_data(cpu, data, size):
    event =  bpf["events"].event(data)
    print(f"Process {event.pid} ext4 failed")


bpf["events"].open_ring_buffer(process_event_data)

while True:
    try:
        bpf.ring_buffer_consume()
    except KeyboardInterrupt:
        exit()
```

然后我们写段很短的 Python 脚本

```python
import uuid
import os

for i in range(200000000):
    if i % 100000 == 0:
        print(f"we have created {i} files")
    filename=str(uuid.uuid4())
    file_name=f"/data1/cache/{filename}+{filename}.txt"
    with open(file_name, "w+") as f:
        f.write("")
```

然后我们看到执行结果

![执行结果](https://user-images.githubusercontent.com/7054676/211157342-812406e1-45c4-42f0-9ff4-3c4c3d5bcb05.png)

符合预期，那么我们可以说这个问题的排查路径的因果关系链完整了。那么我们也可以正式宣告解决了这个问题了

那么锦上添花的一点，对于这种上游的问题，我们如果能找到具体在什么时间点进行了修复，那就更好了。就这个 case 而言，ext4 的 large_dir 在 Linux 4.13 中得到引入，具体可以参见 [88a399955a97fe58ddb2a46ca5d988caedac731b<sup>6</sup>](#refer-anchor-6) 这个 commit。

OK 这个问题就告一段落

## 总结

其实这个问题比较冷门，但是排查方式其实是挺典型的线上问题的排查方法。对于问题，不要预设结果，一步步的根据现象去逼近最终的结论。以及 eBPF 真的好东西，能帮助做很多内核的事。最后我的 Linux 文件系统方面的底子还是太薄弱了，希望后面能重点加强一下

差不多就这样

## Reference

<div id="refer-anchor-1"></div>

- [1]. [https://docs.docker.com/storage/bind-mounts/](https://docs.docker.com/storage/bind-mounts/)

<div id="refer-anchor-2"></div>]

- [2]. [https://man7.org/linux/man-pages/man2/fallocate.2.html](https://man7.org/linux/man-pages/man2/fallocate.2.html)

<div id="refer-anchor-3"></div>

- [3]. [https://man7.org/linux/man-pages/man8/fdisk.8.html](https://man7.org/linux/man-pages/man8/fdisk.8.html)

<div id="refer-anchor-4"></div>

- [4]. [https://linux.die.net/man/8/tune2fs](https://linux.die.net/man/8/tune2fs)

<div id="refer-anchor-5"></div>

- [5]. [https://man7.org/linux/man-pages/man1/dmesg.1.html](https://man7.org/linux/man-pages/man1/dmesg.1.html)

<div id="refer-anchor-6"></div>

- [6]. [https://git.kernel.org/pub/scm/linux/kernel/git/tytso/ext4.git/commit/?h=dev&id=88a399955a97fe58ddb2a46ca5d988caedac731b](https://git.kernel.org/pub/scm/linux/kernel/git/tytso/ext4.git/commit/?h=dev&id=88a399955a97fe58ddb2a46ca5d988caedac731b)
