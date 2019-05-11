---
title: Python concurrent.future 使用教程及源码初剖
type: tags
date: 2017-11-28 00:09:54
tags: [Python,编程,并发编程,编程技巧,源码剖析]
categories: [编程,Python]
---

# 垃圾话

很久没写博客了，想了想不能再划水，于是给自己定了一个目标，写点 **concurrent.future** 的内容，于是这篇文章就是来聊聊 Python 3.2 中新增的 **concurrent.future** 模块。

<!--more-->

# 正文

## Python 的异步处理

有一个 Python 开发工程师小明，在面试过程中，突然接到这样一个需求：去请求几个网站，拿到他们的数据，小明定睛一想，简单啊，噼里啪啦，他写了如下的代码

~~~Python

import multiprocessing
import time


def request_url(query_url: str):
    time.sleep(3)  # 请求处理逻辑


if __name__ == '__main__':
    url_list = ["abc.com", "xyz.com"]
    task_list = [multiprocessing.Process(target=request_url, args=(url,)) for url in url_list]
    [task.start() for task in task_list]
    [task.join() for task in task_list]
~~~

Easy, 好了，现在新的需求来了，我们想获取每一个请求结果，怎么办?小明想了想，又写出如下的代码

~~~Python

import multiprocessing
import time


def request_url(query_url: str, result_dict: dict):
    time.sleep(3)  # 请求处理逻辑
    result_dict[query_url] = {}  # 返回结果


if __name__ == '__main__':
    process_manager = multiprocessing.Manager()
    result_dict = process_manager.dict()
    url_list = ["abc.com", "xyz.com"]
    task_list = [multiprocessing.Process(target=request_url, args=(url, result_dict)) for url in url_list]
    [task.start() for task in task_list]
    [task.join() for task in task_list]
    print(result_dict)
~~~

好了，面试官说，恩看起来不错，好了，我再改改题目，首先，我们不能阻塞主进程，主进程需要根据任务当前的状态（结束/未结束）来及时的获取对应的结果，怎么改？，小明想了想，要不，我们直接用信号量，让任务完成后，向父进程发送一个信号量？然后直接暴力出奇迹？还有更简单的方法么？貌似没了？最后面试官心理说了一句 naive ，脸上笑而不语，让小明回去慢慢等消息。

从小明的窘境，我们可以看出一个这样的问题，就是我们最常用的 `multiprocessing` 或者是 `threding` 两个模块，对于我们想实现异步任务的场景来说，其实略有一点不友好的，我们往往需要做一些额外的工作，才能比较干净的实现一些异步的需求。为了解决这样的窘境，09 年 10 月，Brian Quinlan 先生提出了 [PEP 3148](https://www.python.org/dev/peps/pep-3148/) ，在这个提案中，他提出将我们常用的 `multiprocessing` 和 `threding` 模块进行进一步封装，达成较好的支持异步操作的目的。最终这个提案在 Python 3.2 中被引入。也就是我们今天要聊聊的 **concurrent.future** 。

## Future 模式

在我们正式开始聊新模块之前，我们需要去了解关于 `Future` 模式的相关姿势

首先 `Future` 模式，是什么？

`Future` 其实是**生产-消费者**模型的一种扩展，在**生产-消费者**模型中，生产者不关心消费者什么时候处理完数据，也不关心消费者处理的结果。比如我们经常写出如下的代码

~~~Python

import multiprocessing, Queue
import os
import time
from multiprocessing import Process
from time import sleep
from random import randint

class Producer(multiprocessing.Process):
    def __init__(self, queue):
        multiprocessing.Process.__init__(self)
        self.queue = queue
        
    def run(self):
        while True:
            self.queue.put('one product')
            print(multiprocessing.current_process().name + str(os.getpid()) + ' produced one product, the no of queue now is: %d' %self.queue.qsize())
            sleep(randint(1, 3))
        
        
class Consumer(multiprocessing.Process):
    def __init__(self, queue):
        multiprocessing.Process.__init__(self)
        self.queue = queue
        
    def run(self):
        while True:
            d = self.queue.get(1)
            if d != None:
                print(multiprocessing.current_process().name + str(os.getpid()) + ' consumed  %s, the no of queue now is: %d' %(d,self.queue.qsize()))
                sleep(randint(1, 4))
                continue
            else:
                break
                
#create queue
queue = multiprocessing.Queue(40)
       
if __name__ == "__main__":
    print('Excited!")
    #create processes    
    processed = []
    for i in range(3):
        processed.append(Producer(queue))
        processed.append(Consumer(queue))
        
    #start processes        
    for i in range(len(processed)):
        processed[i].start()
    
    #join processes    
    for i in range(len(processed)):
        processed[i].join()  
~~~

这就是**生产-消费者**模型的一个简单的实现，我们利用一个 `multiprocessing` 中的 `Queue` 来作为通信渠道，我们的生产者负责往队列中传入数据，消费者负责从队列中获取数据并处理。不过就如同上面所说的一样，在这种模式中，生产者并不关心消费者何时处理完数据，也不关心处理的结果。而在 `Future` 中，我们可以让生产者等待消息处理完成，如果需要的话，我们还可以获取相关的计算结果。

比如，大家可以看看下面这样一段 Java 代码

~~~java
package concurrent;

import java.util.concurrent.Callable;

public class DataProcessThread implements Callable<String> {

	@Override
	public String call() throws Exception {
		// TODO Auto-generated method stub
		Thread.sleep(10000);//模拟数据处理
		return "数据返回";
	}

}
~~~

这是我们负责处理数据的代码。

~~~java

package concurrent;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;

public class MainThread {

	public static void main(String[] args) throws InterruptedException,
			ExecutionException {
		// TODO Auto-generated method stub
		DataProcessThread dataProcessThread = new DataProcessThread();
		FutureTask<String> future = new FutureTask<String>(dataProcessThread);

		ExecutorService executor = Executors.newFixedThreadPool(1);
		executor.submit(future);

		Thread.sleep(10000);//模拟继续处理自身其他业务
		while (true) {
			if (future.isDone()) {
				System.out.println(future.get());
				break;
			}
		}
		executor.shutdown();
	}

}

~~~

这是我们主线程，大家可以看到，我们可以很方便的获取数据处理任务的状态。同时获取相关的结果。

## Python 中的 concurrent.futures

前面说了，在 Python 3.2 以后，**concurrent.futures**　是内置的模块，我们可以直接使用

> **Note**: 如果你需要在 Python 2.7 中使用 **concurrent.futures** , 那么请用 pip 进行安装，`pip install futures` 


好了，准备就绪后，我们来看看怎么使用这个东西呢

~~~Python

from concurrent.futures import ProcessPoolExecutor
import time


def return_future_result(message):
    time.sleep(2)
    return message


if __name__ == '__main__':
    pool = ProcessPoolExecutor(max_workers=2)  # 创建一个最大可容纳2个task的进程池
    future1 = pool.submit(return_future_result, ("hello"))  # 往进程池里面加入一个task
    future2 = pool.submit(return_future_result, ("world"))  # 往进程池里面加入一个task
    print(future1.done())  # 判断task1是否结束
    time.sleep(3)
    print(future2.done())  # 判断task2是否结束
    print(future1.result())  # 查看task1返回的结果
    print(future2.result())  # 查看task2返回的结果
~~~

首先 `from concurrent.futures import ProcessPoolExecutor` 从 `concurrent.futures` 引入 `ProcessPoolExecutor` 作为我们的进程池，处理我们后面的数据。(在 `concurrent.futures` 中，为我们提供了两种 `Executor` ，一种是我们现在用的 `ProcessPoolExecutor`, 一种是 `ThreadPoolExecutor` 他们对外暴露的方法一致，大家可以根据自己的实际需求选用。)

紧接着，初始化一个最大容量为 2 的进程池。然后我们调用进程池中的 `submit` 方法提交一个任务。好了有意思的点来了，我们在调用 `submit` 方法后，得到了一个特殊的变量，这个变量是 `Future` 类的实例，代表着一个在未来完成的操作。换句话说，当 `submit` 返回 `Future` 实例的时候，我们的任务可能还没有完成，我们可以通过调用 `Future` 实例中的 `done` 方法来获取当前任务的运行状态，如果任务结束后，我们可以通过 `result` 方法来获取返回的结果。如果在执行后续的逻辑时，我们因为一些原因想要取消任务时，我们可以通过调用 `cancel` 方法来取消当前的任务。

现在新的问题来了，我们如果想要提交很多个任务应该怎么办呢？`concurrent.future` 为我们提供了 `map` 方法来方便我们批量添加任务。

~~~Python
import concurrent.futures
import requests

task_url = [('http://www.baidu.com', 40), ('http://example.com/', 40), ('https://www.github.com/', 40)]


def load_url(params: tuple):
    return requests.get(params[0], timeout=params[1]).text


if __name__ == '__main__':
    with concurrent.futures.ProcessPoolExecutor(max_workers=3) as executor:
        for url, data in zip(task_url, executor.map(load_url, task_url)):
            print('%r page is %d bytes' % (url, len(data)))

~~~

恩，`concurrent.future` 中线程/进程池所提供的 `map` 方法和标准库中的 `map` 函数使用方法一样。

## 剖一下 concurrent.futures

前面讲了怎么使用 `concurrent.futures` 后，我们都比较好奇，`concurrent.futures` 是怎么实现 `Future` 模式的。里面是怎么将任务和结果进行关联的。我们现在开始从 `submit` 方法着手来简单看一下 `ProcessPoolExecutor` 的实现。

首先，在初始化 `ProcessPoolExecutor` 时，它的 `__init__` 方法中进行了一些关键变量的初始化操作。

~~~Python

class ProcessPoolExecutor(_base.Executor):
    def __init__(self, max_workers=None):
        """Initializes a new ProcessPoolExecutor instance.

        Args:
            max_workers: The maximum number of processes that can be used to
                execute the given calls. If None or not given then as many
                worker processes will be created as the machine has processors.
        """
        _check_system_limits()

        if max_workers is None:
            self._max_workers = os.cpu_count() or 1
        else:
            if max_workers <= 0:
                raise ValueError("max_workers must be greater than 0")

            self._max_workers = max_workers

        # Make the call queue slightly larger than the number of processes to
        # prevent the worker processes from idling. But don't make it too big
        # because futures in the call queue cannot be cancelled.
        self._call_queue = multiprocessing.Queue(self._max_workers +
                                                 EXTRA_QUEUED_CALLS)
        # Killed worker processes can produce spurious "broken pipe"
        # tracebacks in the queue's own worker thread. But we detect killed
        # processes anyway, so silence the tracebacks.
        self._call_queue._ignore_epipe = True
        self._result_queue = SimpleQueue()
        self._work_ids = queue.Queue()
        self._queue_management_thread = None
        # Map of pids to processes
        self._processes = {}

        # Shutdown is a two-step process.
        self._shutdown_thread = False
        self._shutdown_lock = threading.Lock()
        self._broken = False
        self._queue_count = 0
        self._pending_work_items = {}
~~~

好了，我们来看看我们今天的入口 `submit` 方法

~~~Python

def submit(self, fn, *args, **kwargs):
    with self._shutdown_lock:
        if self._broken:
            raise BrokenProcessPool('A child process terminated '
                'abruptly, the process pool is not usable anymore')
        if self._shutdown_thread:
            raise RuntimeError('cannot schedule new futures after shutdown')
        f = _base.Future()
        w = _WorkItem(f, fn, args, kwargs)
        self._pending_work_items[self._queue_count] = w
        self._work_ids.put(self._queue_count)
        self._queue_count += 1
        # Wake up queue management thread
        self._result_queue.put(None)
        self._start_queue_management_thread()
        return f
~~~

首先，传入的参数 `fn` 是我们的处理函数，`args` 以及 `kwargs` 是我们要传递 `fn` 函数的参数。在 `submit` 函数最开始，首先根据 `_broken` 和 `_shutdown_thread` 的值来判断当前进程池中处理进程的状态以及目前进程池的状态。如果处理进程突然被销毁或者进程池已经被关闭，那么将抛出异常表明目前不再接受新的 `submit` 操作。

如果前面状态没有问题，首先，实例化 `Future` 类，然后将这个实例和处理函数和相关参数一起，作为参数来实例化 `_WorkItem` 类，然后将实例 w 作为 value ，`_queue_count` 作为 key 存入 `_pending_work_items` 中。然后调用 `_start_queue_management_thread` 方法开启进程池中的管理线程。现在来看看这部分代码

~~~Python

def _start_queue_management_thread(self):
    # When the executor gets lost, the weakref callback will wake up
    # the queue management thread.
    def weakref_cb(_, q=self._result_queue):
        q.put(None)

    if self._queue_management_thread is None:
        # Start the processes so that their sentinels are known.
        self._adjust_process_count()
        self._queue_management_thread = threading.Thread(
            target=_queue_management_worker,
            args=(weakref.ref(self, weakref_cb),
                  self._processes,
                  self._pending_work_items,
                  self._work_ids,
                  self._call_queue,
                  self._result_queue))
        self._queue_management_thread.daemon = True
        self._queue_management_thread.start()
        _threads_queues[self._queue_management_thread] = self._result_queue
~~~

这一部分很简单，首先运行 `_adjust_process_count` 方法，然后开启一个守护线程，运行 `_queue_management_worker` 方法。我们首先来看看 `_adjust_process_count` 方法。

~~~Python
def _adjust_process_count(self):
    for _ in range(len(self._processes), self._max_workers):
        p = multiprocessing.Process(
                target=_process_worker,
                args=(self._call_queue,
                      self._result_queue))
        p.start()
        self._processes[p.pid] = p
~~~

根据在 `__init__` 方法中设定的 `_max_workers` 来开启对应数量的进程，在进程中运行 `_process_worker` 函数。

恩，顺藤摸瓜，我们先来看看 `_process_worker` 函数吧？

~~~Python

def _process_worker(call_queue, result_queue):
    """Evaluates calls from call_queue and places the results in result_queue.

    This worker is run in a separate process.

    Args:
        call_queue: A multiprocessing.Queue of _CallItems that will be read and
            evaluated by the worker.
        result_queue: A multiprocessing.Queue of _ResultItems that will written
            to by the worker.
        shutdown: A multiprocessing.Event that will be set as a signal to the
            worker that it should exit when call_queue is empty.
    """
    while True:
        call_item = call_queue.get(block=True)
        if call_item is None:
            # Wake up queue management thread
            result_queue.put(os.getpid())
            return
        try:
            r = call_item.fn(*call_item.args, **call_item.kwargs)
        except BaseException as e:
            exc = _ExceptionWithTraceback(e, e.__traceback__)
            result_queue.put(_ResultItem(call_item.work_id, exception=exc))
        else:
            result_queue.put(_ResultItem(call_item.work_id,
                                         result=r))
~~~

首先，这里搞了一个死循环，紧接着，我们从 `call_queue` 队列中获取一个 `_WorkItem` 实例，然后如果获取的值为 `None` 的话，那么证明没有新的任务进来了，我们可以把当前进程的 `pid` 放入结果队列中。然后结束进程。

如果收到了任务，那么执行这个任务。不管是在执行过程中发生异常，亦或者是得到最终的结果，都将其封装为 `_ResultItem` 实例，并将其放入结果队列中。

好了，我们回到刚刚看了一半的 `_start_queue_management_thread` 函数，

~~~Python

def _start_queue_management_thread(self):
    # When the executor gets lost, the weakref callback will wake up
    # the queue management thread.
    def weakref_cb(_, q=self._result_queue):
        q.put(None)

    if self._queue_management_thread is None:
        # Start the processes so that their sentinels are known.
        self._adjust_process_count()
        self._queue_management_thread = threading.Thread(
            target=_queue_management_worker,
            args=(weakref.ref(self, weakref_cb),
                  self._processes,
                  self._pending_work_items,
                  self._work_ids,
                  self._call_queue,
                  self._result_queue))
        self._queue_management_thread.daemon = True
        self._queue_management_thread.start()
        _threads_queues[self._queue_management_thread] = self._result_queue
~~~

在执行完 `_adjust_process_count` 函数后，我们进程池中的 `_processes` 变量（它是一个 dict ）便关联了一些处理进程。然后我们开启一个后台守护线程，来执行 `_queue_management_worker` 函数，我们给它传了几个变量，首先 `_processes` 是我们的进程映射，`_pending_work_items` 中存放着我们待处理任务，还有 `_call_queue` 和 `_result_queue` 。好了还有一个参数大家可能不太理解，就是 `weakref.ref(self, weakref_cb)` 这货。

首先，Python 是一门具有垃圾回收机制的语言，有着 GC (Garbage Collection) 机制意味着我们在大多数时候，不太需要去关注内存的分配与回收。在 Python 中，什么时候对象会被回收是由其引用计数所决定的。当引用计数为 0 的时候，这个对象会被回收。在有一些情况下，我们对象因为交叉引用或者其余的一些原因，造成引用计数始终不为0，这意味着这个对象无法被回收。造成内存泄露
。因此区别于我们普通的引用，Python 中新增了一个引用机制叫做弱引用，弱引用的意义在于，某个变量持有一个对象，却不会增加这个对象的引用计数。因此 `weakref.ref(self, weakref_cb)` 在大多数而言，等价于 `self` （至于这里为什么要使用弱引用，我们这里先不讲，会开一个单章来说）

好了，这一部分代码看完，我们来看看，`_queue_management_worker` 怎么实现的

~~~Python

def _queue_management_worker(executor_reference,
                             processes,
                             pending_work_items,
                             work_ids_queue,
                             call_queue,
                             result_queue):
    """Manages the communication between this process and the worker processes.

    This function is run in a local thread.

        executor_reference: A weakref.ref to the ProcessPoolExecutor that owns
    Args:
        process: A list of the multiprocessing.Process instances used as
            this thread. Used to determine if the ProcessPoolExecutor has been
            garbage collected and that this function can exit.
            workers.
        pending_work_items: A dict mapping work ids to _WorkItems e.g.
            {5: <_WorkItem...>, 6: <_WorkItem...>, ...}
        work_ids_queue: A queue.Queue of work ids e.g. Queue([5, 6, ...]).
        call_queue: A multiprocessing.Queue that will be filled with _CallItems
            derived from _WorkItems for processing by the process workers.
        result_queue: A multiprocessing.Queue of _ResultItems generated by the
            process workers.
    """
    executor = None

    def shutting_down():
        return _shutdown or executor is None or executor._shutdown_thread

    def shutdown_worker():
        # This is an upper bound
        nb_children_alive = sum(p.is_alive() for p in processes.values())
        for i in range(0, nb_children_alive):
            call_queue.put_nowait(None)
        # Release the queue's resources as soon as possible.
        call_queue.close()
        # If .join() is not called on the created processes then
        # some multiprocessing.Queue methods may deadlock on Mac OS X.
        for p in processes.values():
            p.join()

    reader = result_queue._reader

    while True:
        _add_call_item_to_queue(pending_work_items,
                                work_ids_queue,
                                call_queue)

        sentinels = [p.sentinel for p in processes.values()]
        assert sentinels
        ready = wait([reader] + sentinels)
        if reader in ready:
            result_item = reader.recv()
        else:
            # Mark the process pool broken so that submits fail right now.
            executor = executor_reference()
            if executor is not None:
                executor._broken = True
                executor._shutdown_thread = True
                executor = None
            # All futures in flight must be marked failed
            for work_id, work_item in pending_work_items.items():
                work_item.future.set_exception(
                    BrokenProcessPool(
                        "A process in the process pool was "
                        "terminated abruptly while the future was "
                        "running or pending."
                    ))
                # Delete references to object. See issue16284
                del work_item
            pending_work_items.clear()
            # Terminate remaining workers forcibly: the queues or their
            # locks may be in a dirty state and block forever.
            for p in processes.values():
                p.terminate()
            shutdown_worker()
            return
        if isinstance(result_item, int):
            # Clean shutdown of a worker using its PID
            # (avoids marking the executor broken)
            assert shutting_down()
            p = processes.pop(result_item)
            p.join()
            if not processes:
                shutdown_worker()
                return
        elif result_item is not None:
            work_item = pending_work_items.pop(result_item.work_id, None)
            # work_item can be None if another process terminated (see above)
            if work_item is not None:
                if result_item.exception:
                    work_item.future.set_exception(result_item.exception)
                else:
                    work_item.future.set_result(result_item.result)
                # Delete references to object. See issue16284
                del work_item
        # Check whether we should start shutting down.
        executor = executor_reference()
        # No more work items can be added if:
        #   - The interpreter is shutting down OR
        #   - The executor that owns this worker has been collected OR
        #   - The executor that owns this worker has been shutdown.
        if shutting_down():
            try:
                # Since no new work items can be added, it is safe to shutdown
                # this thread if there are no pending work items.
                if not pending_work_items:
                    shutdown_worker()
                    return
            except Full:
                # This is not a problem: we will eventually be woken up (in
                # result_queue.get()) and be able to send a sentinel again.
                pass
        executor = None
~~~

熟悉的大循环，循环的第一步，利用 `_add_call_item_to_queue` 函数来将等待队列中的任务加入到调用队列中去，先来看看这一部分代码

~~~Python
def _add_call_item_to_queue(pending_work_items,
                            work_ids,
                            call_queue):
    """Fills call_queue with _WorkItems from pending_work_items.

    This function never blocks.

    Args:
        pending_work_items: A dict mapping work ids to _WorkItems e.g.
            {5: <_WorkItem...>, 6: <_WorkItem...>, ...}
        work_ids: A queue.Queue of work ids e.g. Queue([5, 6, ...]). Work ids
            are consumed and the corresponding _WorkItems from
            pending_work_items are transformed into _CallItems and put in
            call_queue.
        call_queue: A multiprocessing.Queue that will be filled with _CallItems
            derived from _WorkItems.
    """
    while True:
        if call_queue.full():
            return
        try:
            work_id = work_ids.get(block=False)
        except queue.Empty:
            return
        else:
            work_item = pending_work_items[work_id]

            if work_item.future.set_running_or_notify_cancel():
                call_queue.put(_CallItem(work_id,
                                         work_item.fn,
                                         work_item.args,
                                         work_item.kwargs),
                               block=True)
            else:
                del pending_work_items[work_id]
                continue
~~~

首先，判断调用队列是不是已经满了，如果满了，则放弃这次循环。紧接着从 `work_id` 队列中取出，然后从等待任务中取出对应的 `_WorkItem` 实例。紧接着，调用实例中绑定的 `Future` 实例的 `set_running_or_notify_cancel` 方法来设置任务的状态，紧接着将其扔入调用队列中。

~~~Python

def set_running_or_notify_cancel(self):
    """Mark the future as running or process any cancel notifications.

    Should only be used by Executor implementations and unit tests.

    If the future has been cancelled (cancel() was called and returned
    True) then any threads waiting on the future completing (though calls
    to as_completed() or wait()) are notified and False is returned.

    If the future was not cancelled then it is put in the running state
    (future calls to running() will return True) and True is returned.

    This method should be called by Executor implementations before
    executing the work associated with this future. If this method returns
    False then the work should not be executed.

    Returns:
        False if the Future was cancelled, True otherwise.

    Raises:
        RuntimeError: if this method was already called or if set_result()
            or set_exception() was called.
    """
    with self._condition:
        if self._state == CANCELLED:
            self._state = CANCELLED_AND_NOTIFIED
            for waiter in self._waiters:
                waiter.add_cancelled(self)
            # self._condition.notify_all() is not necessary because
            # self.cancel() triggers a notification.
            return False
        elif self._state == PENDING:
            self._state = RUNNING
            return True
        else:
            LOGGER.critical('Future %s in unexpected state: %s',
                            id(self),
                            self._state)
            raise RuntimeError('Future in unexpected state')
~~~

这一部分内容很简单，检查当前实例如果处于等待状态，就返回 True ，如果处于被取消的状态，就返回 False , 在 `_add_call_item_to_queue` 函数中，会将已经处于 `cancel` 状态的 `_WorkItem` 从等待任务中移除。

好了，我们继续回到 `_queue_management_worker` 函数中去，

~~~Python

def _queue_management_worker(executor_reference,
                             processes,
                             pending_work_items,
                             work_ids_queue,
                             call_queue,
                             result_queue):
    """Manages the communication between this process and the worker processes.

    This function is run in a local thread.

        executor_reference: A weakref.ref to the ProcessPoolExecutor that owns
    Args:
        process: A list of the multiprocessing.Process instances used as
            this thread. Used to determine if the ProcessPoolExecutor has been
            garbage collected and that this function can exit.
            workers.
        pending_work_items: A dict mapping work ids to _WorkItems e.g.
            {5: <_WorkItem...>, 6: <_WorkItem...>, ...}
        work_ids_queue: A queue.Queue of work ids e.g. Queue([5, 6, ...]).
        call_queue: A multiprocessing.Queue that will be filled with _CallItems
            derived from _WorkItems for processing by the process workers.
        result_queue: A multiprocessing.Queue of _ResultItems generated by the
            process workers.
    """
    executor = None

    def shutting_down():
        return _shutdown or executor is None or executor._shutdown_thread

    def shutdown_worker():
        # This is an upper bound
        nb_children_alive = sum(p.is_alive() for p in processes.values())
        for i in range(0, nb_children_alive):
            call_queue.put_nowait(None)
        # Release the queue's resources as soon as possible.
        call_queue.close()
        # If .join() is not called on the created processes then
        # some multiprocessing.Queue methods may deadlock on Mac OS X.
        for p in processes.values():
            p.join()

    reader = result_queue._reader

    while True:
        _add_call_item_to_queue(pending_work_items,
                                work_ids_queue,
                                call_queue)

        sentinels = [p.sentinel for p in processes.values()]
        assert sentinels
        ready = wait([reader] + sentinels)
        if reader in ready:
            result_item = reader.recv()
        else:
            # Mark the process pool broken so that submits fail right now.
            executor = executor_reference()
            if executor is not None:
                executor._broken = True
                executor._shutdown_thread = True
                executor = None
            # All futures in flight must be marked failed
            for work_id, work_item in pending_work_items.items():
                work_item.future.set_exception(
                    BrokenProcessPool(
                        "A process in the process pool was "
                        "terminated abruptly while the future was "
                        "running or pending."
                    ))
                # Delete references to object. See issue16284
                del work_item
            pending_work_items.clear()
            # Terminate remaining workers forcibly: the queues or their
            # locks may be in a dirty state and block forever.
            for p in processes.values():
                p.terminate()
            shutdown_worker()
            return
        if isinstance(result_item, int):
            # Clean shutdown of a worker using its PID
            # (avoids marking the executor broken)
            assert shutting_down()
            p = processes.pop(result_item)
            p.join()
            if not processes:
                shutdown_worker()
                return
        elif result_item is not None:
            work_item = pending_work_items.pop(result_item.work_id, None)
            # work_item can be None if another process terminated (see above)
            if work_item is not None:
                if result_item.exception:
                    work_item.future.set_exception(result_item.exception)
                else:
                    work_item.future.set_result(result_item.result)
                # Delete references to object. See issue16284
                del work_item
        # Check whether we should start shutting down.
        executor = executor_reference()
        # No more work items can be added if:
        #   - The interpreter is shutting down OR
        #   - The executor that owns this worker has been collected OR
        #   - The executor that owns this worker has been shutdown.
        if shutting_down():
            try:
                # Since no new work items can be added, it is safe to shutdown
                # this thread if there are no pending work items.
                if not pending_work_items:
                    shutdown_worker()
                    return
            except Full:
                # This is not a problem: we will eventually be woken up (in
                # result_queue.get()) and be able to send a sentinel again.
                pass
        executor = None
~~~

`result_item` 变量

我们看看

首先，大家可能在这里有点疑问了

~~~Python

sentinels = [p.sentinel for p in processes.values()]
assert sentinels
ready = wait([reader] + sentinels)

~~~

这个 `wait` 是什么鬼啊，`reader` 又是什么鬼啊。一步步来。首先，我们看到，前面，`reader = result_queue._reader` 也会引起大家的疑问，这里我们 `result_queue` 是 `multiprocess` 里面的 `SimpleQueue` 啊，它没有 `_reader` 方法啊QAQ

~~~Python

class SimpleQueue(object):

    def __init__(self, *, ctx):
        self._reader, self._writer = connection.Pipe(duplex=False)
        self._rlock = ctx.Lock()
        self._poll = self._reader.poll
        if sys.platform == 'win32':
            self._wlock = None
        else:
            self._wlock = ctx.Lock()
~~~

上面这贴出来的，是 `SimpleQueue` 的部分代码，我们可以很清楚的看到，`SimpleQueue` 本质是利用一个 `Pipe` 来进行进程间通信的，然后 `_reader` 是读取 `Pipe` 的一个变量。

> **Note** : 大家可以复习下其余几种进程间通信的方法了

好了，这一部分看懂后，我们来看看 `wait` 方法吧。

~~~Python

def wait(object_list, timeout=None):
    '''
    Wait till an object in object_list is ready/readable.

    Returns list of those objects in object_list which are ready/readable.
    '''
    with _WaitSelector() as selector:
        for obj in object_list:
            selector.register(obj, selectors.EVENT_READ)

        if timeout is not None:
            deadline = time.time() + timeout

        while True:
            ready = selector.select(timeout)
            if ready:
                return [key.fileobj for (key, events) in ready]
            else:
                if timeout is not None:
                    timeout = deadline - time.time()
                    if timeout < 0:
                        return ready
~~~

这一部分代码很简单，首先将我们待读取的对象，进行一次注册，然后当 `timeout` 为 None 的时候，就一直等待到有对象读取数据成功为止

好了，我们继续回到前面的 `_queue_management_worker` 函数中去，来看看这样一段代码

~~~Python

        ready = wait([reader] + sentinels)
        if reader in ready:
            result_item = reader.recv()
        else:
            # Mark the process pool broken so that submits fail right now.
            executor = executor_reference()
            if executor is not None:
                executor._broken = True
                executor._shutdown_thread = True
                executor = None
            # All futures in flight must be marked failed
            for work_id, work_item in pending_work_items.items():
                work_item.future.set_exception(
                    BrokenProcessPool(
                        "A process in the process pool was "
                        "terminated abruptly while the future was "
                        "running or pending."
                    ))
                # Delete references to object. See issue16284
                del work_item
            pending_work_items.clear()
            # Terminate remaining workers forcibly: the queues or their
            # locks may be in a dirty state and block forever.
            for p in processes.values():
                p.terminate()
            shutdown_worker()
            return
~~~

我们用 `wait` 函数来读取一系列对象，因为我们没有设置 `Timeout` ，所以当我们拿到可读取对象的结果时，如果 `result_queue._reader` 没有在列表中，那么意味着，有处理进程突然异常关闭了，这个时候，我们开始执行后面的语句来执行目前进程池的关闭操作。如果在列表中，我们读取数据，得到 `result_item` 变量

我们再看看下面的代码

~~~Python

if isinstance(result_item, int):
    # Clean shutdown of a worker using its PID
    # (avoids marking the executor broken)
    assert shutting_down()
    p = processes.pop(result_item)
    p.join()
    if not processes:
        shutdown_worker()
        return
elif result_item is not None:
    work_item = pending_work_items.pop(result_item.work_id, None)
    # work_item can be None if another process terminated (see above)
    if work_item is not None:
        if result_item.exception:
            work_item.future.set_exception(result_item.exception)
        else:
            work_item.future.set_result(result_item.result)
        # Delete references to object. See issue16284
        del work_item

~~~

首先，如果 `result_item` 变量是 int 类型的话，不知道大家还记不记得在 `_process_worker` 函数中有这样一段逻辑

~~~Python

call_item = call_queue.get(block=True)
if call_item is None:
    # Wake up queue management thread
    result_queue.put(os.getpid())
    return
~~~

当调用队列中没有新的任务时，将进程 `pid` 放入 `result_queue` 中。那么我们 `result_item` 如果值为 `int` 那么意味着，我们之前任务处理工作已经完毕，于是开始清理，关闭我们的进程池。

如果 `result_item` 既不为 `int` 也不为 `None` , 那么必然是 `_ResultItem` 的实例，我们根据 `work_id` 取出 `_WorkItem` 实例，并将产生的异常或者值和 `_WorkItem` 实例中的 `Future` 实例（也就是我们 submit 后返回的那货）进行绑定。

最后，删除这个 `work_item` ，完事儿，手工

## 最后

洋洋洒洒写了一大篇辣鸡文章，希望大家不要介意，其实我们能看到 `concurrent.future` 的实现，其实并没有用什么高深的黑魔法，但是其中细节值得我们一一品味，所以这篇文章我们先写到这里。后面有机会的话，我们再去看看 `concurrent.future` 其余部分代码。也有蛮多值得品味的地方。

## Reference

1.[Python 3 multiprocessing](https://docs.python.org/3/library/multiprocessing.html#multiprocessing.SimpleQueue)

2.[Python 3 weakref](https://docs.python.org/3/library/weakref.html)

3.[并发编程之Future模式](https://my.oschina.net/u/1255754/blog/207331)

4.[Python并发编程之线程池/进程池](https://www.ziwenxie.site/2016/12/24/python-concurrent-futures/)

5.[Future 模式详解（并发使用）](http://zha-zi.iteye.com/blog/1408189)
