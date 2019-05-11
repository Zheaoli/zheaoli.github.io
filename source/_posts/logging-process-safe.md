---
title: 日常辣鸡水文:关于 logging 的进程安全问题
type: tags
date: 2018-02-23 02:54:21
tags: [Python,编程,Flask,源码阅读]
categories: [编程,Python]
---

## 日常辣鸡水文:关于 logging 的进程安全问题

团队聚餐喝了点酒，作为一个垃圾文档工程师来写一篇日常水文

### 正文

现在团队的日志搜集方式从原本的 TCP 直传 logstash 的方式改进为写入一个单文件后，改用 FileBeat 来作为日志搜集的前端。但是这样时常带来一个问题，即日志丢失

嗯，我们线上服务是 Gunicorn 启用多个 Worker 来处理的。这就有个问题了，我们都知道，logging 模块是 Thread Safe 的，在标准的 Log Handler 内部加了一系列锁来确保线程安全，但是 logging 直写文件是不是进程安全的呢？

<!-- more -->

### 分析

我们写文件的方式是用的是 `logging` 模块中自带的 `FileHandler` ，首先看看它源码吧

~~~Python
class FileHandler(StreamHandler):
    """
    A handler class which writes formatted logging records to disk files.
    """
    def __init__(self, filename, mode='a', encoding=None, delay=False):
        """
        Open the specified file and use it as the stream for logging.
        """
        # Issue #27493: add support for Path objects to be passed in
        filename = os.fspath(filename)
        #keep the absolute path, otherwise derived classes which use this
        #may come a cropper when the current directory changes
        self.baseFilename = os.path.abspath(filename)
        self.mode = mode
        self.encoding = encoding
        self.delay = delay
        if delay:
            #We don't open the stream, but we still need to call the
            #Handler constructor to set level, formatter, lock etc.
            Handler.__init__(self)
            self.stream = None
        else:
            StreamHandler.__init__(self, self._open())

    def close(self):
        """
        Closes the stream.
        """
        self.acquire()
        try:
            try:
                if self.stream:
                    try:
                        self.flush()
                    finally:
                        stream = self.stream
                        self.stream = None
                        if hasattr(stream, "close"):
                            stream.close()
            finally:
                # Issue #19523: call unconditionally to
                # prevent a handler leak when delay is set
                StreamHandler.close(self)
        finally:
            self.release()

    def _open(self):
        """
        Open the current base file with the (original) mode and encoding.
        Return the resulting stream.
        """
        return open(self.baseFilename, self.mode, encoding=self.encoding)

    def emit(self, record):
        """
        Emit a record.

        If the stream was not opened because 'delay' was specified in the
        constructor, open it before calling the superclass's emit.
        """
        if self.stream is None:
            self.stream = self._open()
        StreamHandler.emit(self, record)

    def __repr__(self):
        level = getLevelName(self.level)
        return '<%s %s (%s)>' % (self.__class__.__name__, self.baseFilename, level)
~~~

嗯，其中关注的点是 `_open` 方法，以及 `emit` 方法，首先科普一个背景知识，在我们用 `logging` 输出日志的时候，`logging` 模块会调用对应 `Handler` 中的 `handle` 方法，在 `handle` 方法中，会调用 `emit` 方法输出最后的日志。于是我们如果使用 `FileHandler` 的话，那么就是先触发 `handle` 方法的调用，然后触发 `emit` 方法，在调用 `_open` 方法获取一个 **file point** 后，调用父类（更准确的描述书 MRO 上一级）**StreamHandler** 中 `emit` 方法。

来看看 `StreamHandler` 中的 `emit` 方法吧

~~~Python
class StreamHandler(Handler):
    """
    A handler class which writes logging records, appropriately formatted,
    to a stream. Note that this class does not close the stream, as
    sys.stdout or sys.stderr may be used.
    """

    terminator = '\n'

    def __init__(self, stream=None):
        """
        Initialize the handler.

        If stream is not specified, sys.stderr is used.
        """
        Handler.__init__(self)
        if stream is None:
            stream = sys.stderr
        self.stream = stream

    def flush(self):
        """
        Flushes the stream.
        """
        self.acquire()
        try:
            if self.stream and hasattr(self.stream, "flush"):
                self.stream.flush()
        finally:
            self.release()

    def emit(self, record):
        """
        Emit a record.

        If a formatter is specified, it is used to format the record.
        The record is then written to the stream with a trailing newline.  If
        exception information is present, it is formatted using
        traceback.print_exception and appended to the stream.  If the stream
        has an 'encoding' attribute, it is used to determine how to do the
        output to the stream.
        """
        try:
            msg = self.format(record)
            stream = self.stream
            stream.write(msg)
            stream.write(self.terminator)
            self.flush()
        except Exception:
            self.handleError(record)

    def __repr__(self):
        level = getLevelName(self.level)
        name = getattr(self.stream, 'name', '')
        if name:
            name += ' '
        return '<%s %s(%s)>' % (self.__class__.__name__, name, level)
~~~

嗯很简单，就是调用我们之前获取的 **file point** 往文件中写入数据

问题就在这里，在 `FileHandler` 中，`_open` 函数中调用 `open` 函数时，所选择的 **mode** 是 `'a'` ，也就是通常而言的 `O_APPEND` 模式。我们知道，通常而言 `O_APPEND` 可以视作进程安全的，因为 `O_APPEND` 能够保证内容不被别的 **O_APPEND** 写操作所覆盖。但是这里为什么会出现日志丢失的情况呢？

原因是在 **POSIX** 中存在着一种特殊设计，在 《POSIX Programmers Guide》 一书中对此描述如下：

* A write of fewer than PIPE_BUF bytes is atomic; the data will not be interleaved with data from other processes writing to the same pipe. A write of more than PIPE_BUF may have data interleaved in arbitrary ways.

这段话翻译大概就是，在 POSIX 中存在着一个变量叫做 `PIPE_BUF` ，这个变量大小为 512 ，在进行写入操作时，如果大小小于 `PIPE_BUF` 值的写操作，是具有原子性的，即不可被打断，因此不会和其余进程写入的值产生混乱，而如果写入的内容大于 `PIPE_BUF` ，则操作系统不能保证这一点。

在 Linux 操作系统中，这个值发生了一点变化

* POSIX.1 says that write(2)s of less than PIPE_BUF bytes must be atomic: the output data is written to the pipe as a contiguous sequence. Writes of more than PIPE_BUF bytes may be nonatomic: the kernel may interleave the data with data written by other processes. POSIX.1 requires PIPE_BUF to be at least 512 bytes. (On Linux, PIPE_BUF is 4096 bytes.) 

即大于 4K 的写入操作都不能保证其原子性，可能会发生数据紊乱。

而发生数据紊乱后，其日志格式不固定，最终造成解析端没法解析，从而最终日志丢失。

这里我们复现一下，首先测试代码



## 最后

这种操作之前从未想过，今天算是打开了新的大门，最后感谢 @依云 前辈的指点= =如果没有前辈的提醒，完全想不到即便是 `O_APPEND` 模式下，数据也不能保证安全。

## Reference

文中参考了两处参考资料，链接如下

1.[OReilly POSIX Programmers Guide](http://maxim.int.ru/bookshelf/OReilly__POSIX_Programmers_Guide.pdf)

2.[Linux Man: PIPE](http://manpages.courier-mta.org/htmlman7/pipe.7.html)