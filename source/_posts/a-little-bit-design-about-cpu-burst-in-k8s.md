---
title: 关于 CPU Burst 在 K8s 中的一些设计想法
type: tags
date: 2023-08-27 03:09:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

深夜看群友聊的我实在焦虑，起来随便写个水文压压惊

<!--more-->

## 正文

写这篇文章的原因是之前给 runc 提的 CPU Burst 支持的 PR [[Carry #3205] libct/cg: add CFS bandwidth burst for CPU](https://github.com/opencontainers/runc/pull/3749) 终于开始有了新的动静了，这次换了一个国人的 reviewer，感觉要是运气好能在9月开始合并这个 PR。

如果这个 PR 被合并了，那么在 containerd/nerdctl 等其余项目上支持 CPU Burst 的工作就可以开始了。所以这篇文章就是想记录下我对于 CPU Burst 在 Kubernetes 内实现的一些想法，差不多可以当作自己写正式的 KEP(Kubernetes Enhancement Proposal) 草稿

主要分为两个部分来聊一下

1. CPU Burst 的一些背景
2. 目前 Kubernetes 对于 CPU 资源切分的设计概要
3. CPU Burst 在 Kubernetes 中的一些设计想法

### CPU Burst 的一些背景

聊 CPU Burst 之前必须要先聊一下 Linux 里面关于 CGroup 的一些背景知识

提到 CPU 限制，本质上是限制进程的 CPU 使用的时间片，在 Linux 下，进程存在三种调度优先级

1. SCHED_NORMAL
2. SCHED_FIFO
3. SCHED_RR

1 用的是 Linux 中 CFS 调度器，而常见普通进程都是 SCHED_NORMAL 。OK 前提知识带过

说回容器中的 CPU 限制，目前主流语境下，容器特指以基于 CGroup 的容器方案为代表的一系列的基于 Linux 中 CGroup 和 Namespace 进行隔离的技术方案。那么在这个语境下，CPU 限制的实现利用了Linux CGroup 中三个 CPU Subsystem。我们主要关心的如下四个参数

1. cpu.cfs_period_us
2. cpu.cfs_quota_us
3. cpu.shares
4. cpuset.cpus

现在分别来聊一下

首先说 cpu.shares，在基于 CGroup 的容器方案中的使用参数是 --cpu-shares，本质上是一个下限的软限制，用来设定 CPU 的利用率权重。默认值是 1024。这里对于相对值可能理解有点抽象。那么我们来看个例子 假如一个 1core 的主机运行 3 个 container，其中一个 cpu-shares 设置为 1024，而其它 cpu-shares 被设置成 512。当 3 个容器中的进程尝试使用 100% CPU 的时候（因为 cpu.shares 针对的是下限，只有使用 100% CPU 很重要，此时才可以体现设置值），则设置 1024 的容器会占用 50% 的 CPU 时间。那再举个例子，之前这个场景，其余的两个容器如果都没有太多任务，那么空余出来的 CPU 时间，是可以继续被第一个 1024 的容器继续使用的

接下来聊一下 cpu.cfs_quota_us 和 cpu.cfs_period_us ，这两个是需要组合使用才能生效，本质上含义是在 cpu.cfs_period_us 的单位时间内，进程最多可以利用 cpu.cfs_quota_us （单位都是 us），如果 quota 耗尽，那么进程会被内核 throttle 。在基于 CGroup 的容器方案下，你可以利用 --cpu-period 和 --cpu-quota 这两个值分别进行设置。也可以通过 --cpu 来进行设置，当我们设置 --cpu 为 2 的时候，容器会保证 cpu.cfs_quota_us 两倍于 cpu.cfs_period_us，剩下的就以此类推了（Docker 默认的 cpu.cfs_period_us 的阈值是 100ms 即 10000us）

在这种模式下，CPU 的时间片按照时间维度基于 period 进行切分，那么在我们实际的生产应用中，我们将会遇到这样的情况，突然来了一波流量/一个任务，进程消耗完了所有的 quota 后，那么将会进入 throttle 的状态。这会导致我们整个响应的 P99 出现很大的毛刺。

CPU Burst 这个特性就是为了解决这个问题而生，它的原理是在已有的语义基础上，新增一个参数 cpu.cfs_burst_us （在 CGroup V2 中 cpu.max.burst），即进程可以在 CPU 利用率比较低的空闲时段积累一定的 credit，然后在密集使用的时候换取一定的 buffer，实现更少的 throttle 和更高的 CPU 利用率（当然这个特性还暂时没有被主流容器所完全支持）

这里可能有人会问，这样不会导致 CPU 限制失效吗？虽然本文不会讨论 burst 的实现（可以单开一篇文章聊），但是可以先给一个结论，目前来看，暂时从数学的角度上利用 WECT(Worst-case Execution Time) 没法给出一个证明说 CPU Burst 是完全可靠的，但是根据已有的测试结果来看，在 CGroup 数量比较多 & CPU 利用率整体不高的情况下，边界是收敛的，具体可以参见相关的讨论[<sup>1</sup>](#refer-anchor-1)

OK，关于 CPU Burst 的背景先聊到这里

### Kubernetes 对于 CPU 资源切分的设计概要

聊完 CPU Burst 的背景，我们需要来聊一下 Kubernetes 对于 CPU 资源怎么做的分割

首先我们起手一段祖传 YAML

```yaml
resources:
    requests:
        cpu: 50m
        memory: 50Mi
    limits:
        cpu: 100m
        memory: 100Mi
```

抛去内存的部分，我们先讨论 CPU 的部分，这个地方很容易理解，我这个 Pod 需要百分之5核的 CPU，最多允许使用10%核的 CPU。

然后在这里，m 是指千分之一核，也就是说 1000m = 1核，那么这里的 50m 就是 5% 核，100m 就是 10% 核。OK 接着往下聊

首先对于我们 requests 部分，Kubernetes 在调度的时候，会利用我们之前提到的 cpu.shares 来设置

而对于我们 limits 的部分，Kubernetes 在调度的时候，会利用我们之前提到的 cpu.cfs_quota_us 和 cpu.cfs_period_us 来设置，在 Kubernetes 中，cpu.cfs_period_us 的默认值是 100ms 即 10000us，那么在我们的例子中，cpu.cfs_quota_us 的值就是 100ms * 10% = 10ms。

OK，大家可能都比较熟悉 Kubernetes 里面的资源的一些基础概念了。那么我们接着回到本文的正题部分：如何在 Kubernetes 中实现 CPU Burst

### 如何在 Kubernetes 中实现 CPU Burst

在 Kubernetes 中实现 CPU Burst 核心的两个问题

1. 语义怎么设计
2. 我怕们节点可能是混部的，换句话说内核版本不一定大于 5.14

这个地方我会考虑三种方案

1. 在 resources 中新增字段
2. 通过 annotation 以及 CRD 来实现
3. 通过 kubelet config 来实现

在聊这三种方案之前，社区其实已经有了一些实现，也是阿里做的，我们先来看一下阿里的实现

#### koordinator 中 CPU Burst 的实现

首先我们来看一下阿里的实现，这个实现是在 koordinator 中实现的，具体的实现可以参见[<sup>2</sup>](#refer-anchor-2)

他们通过 CRD/configmap/annotation 多种方式都可以实现对于 Burst 的支持，比如看一个例子

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: apache-demo
  annotations:
    koordinator.sh/cpuBurst: '{"policy": "auto"}'   # 增加了Cpu Burst策略的开关。
spec:
  containers:
  - command:
    - httpd
    - -D
    - FOREGROUND
    image: registry.cn-zhangjiakou.aliyuncs.com/acs/apache-2-4-51-for-slo-test:v0.1
    imagePullPolicy: Always
    name: apache
    resources:
      limits:
        cpu: "4"
        memory: 10Gi
      requests:
        cpu: "4"
        memory: 10Gi
  nodeName: $nodeName # 注意修改模板中指定节点的nodeName。
  hostNetwork: False
  restartPolicy: Never
  schedulerName: default-scheduler
```

那么问题来了，现在 Kubernetes 中还不支持 burst，那么怎么做的呢，我们直接看下他们核心代码

```go

func (b *cpuBurst) applyContainerCFSQuota(podMeta *statesinformer.PodMeta, containerStat *corev1.ContainerStatus,
	curContaienrCFS, deltaContainerCFS int64) error {
	podDir := podMeta.CgroupDir
	curPodCFS, podPathErr := b.cgroupReader.ReadCPUQuota(podDir)
	if podPathErr != nil {
		return fmt.Errorf("get pod %v/%v current cfs quota failed, error: %v",
			podMeta.Pod.Namespace, podMeta.Pod.Name, podPathErr)
	}
	containerDir, containerPathErr := koordletutil.GetContainerCgroupParentDir(podMeta.CgroupDir, containerStat)
	if containerPathErr != nil {
		return fmt.Errorf("get container %v/%v/%v cgroup path failed, error: %v",
			podMeta.Pod.Namespace, podMeta.Pod.Name, containerStat.Name, containerPathErr)
	}

	updatePodCFSQuota := func() error {
		// no need to adjust pod cpu.cfs_quota if it is already -1
		if curPodCFS <= 0 {
			return nil
		}

		targetPodCFS := curPodCFS + deltaContainerCFS
		podCFSValStr := strconv.FormatInt(targetPodCFS, 10)
		eventHelper := audit.V(3).Pod(podMeta.Pod.Namespace, podMeta.Pod.Name).Reason("CFSQuotaBurst").Message("update pod CFSQuota: %v", podCFSValStr)
		updater, _ := resourceexecutor.DefaultCgroupUpdaterFactory.New(system.CPUCFSQuotaName, podDir, podCFSValStr, eventHelper)
		if _, err := b.executor.Update(true, updater); err != nil {
			return fmt.Errorf("update pod cgroup %v failed, error %v", podMeta.CgroupDir, err)
		}

		return nil
	}

	updateContainerCFSQuota := func() error {
		targetContainerCFS := curContaienrCFS + deltaContainerCFS
		containerCFSValStr := strconv.FormatInt(targetContainerCFS, 10)
		eventHelper := audit.V(3).Container(containerStat.Name).Reason("CFSQuotaBurst").Message("update container CFSQuota: %v", containerCFSValStr)
		updater, _ := resourceexecutor.DefaultCgroupUpdaterFactory.New(system.CPUCFSQuotaName, containerDir, containerCFSValStr, eventHelper)
		if _, err := b.executor.Update(true, updater); err != nil {
			return fmt.Errorf("update container cgroup %v failed, reason %v", containerDir, err)
		}

		return nil
	}

	// cfs scale down, order: container->pod
	sortOfUpdateQuota := []func() error{updateContainerCFSQuota, updatePodCFSQuota}
	if deltaContainerCFS > 0 {
		// cfs scale up, order: pod->container
		sortOfUpdateQuota = []func() error{updatePodCFSQuota, updateContainerCFSQuota}
	}

	for _, update := range sortOfUpdateQuota {
		if err := update(); err != nil {
			return err
		}
	}

	return nil
}

// set cpu.cfs_burst_us for containers
func (b *cpuBurst) applyCPUBurst(burstCfg *slov1alpha1.CPUBurstConfig, podMeta *statesinformer.PodMeta) {
	pod := podMeta.Pod
	containerMap := make(map[string]*corev1.Container)
	for i := range pod.Spec.Containers {
		container := &pod.Spec.Containers[i]
		containerMap[container.Name] = container
	}

	podCFSBurstVal := int64(0)
	for i := range pod.Status.ContainerStatuses {
		containerStat := &pod.Status.ContainerStatuses[i]
		container, exist := containerMap[containerStat.Name]
		if !exist || container == nil {
			klog.Warningf("container %s/%s/%s not found in pod spec", pod.Namespace, pod.Name, containerStat.Name)
			continue
		}

		if containerStat.ContainerID == "" {
			klog.V(5).Infof("container %s/%s/%s got empty id, skip since it may not start",
				pod.Namespace, pod.Name, containerStat.Name)
			continue
		}

		containerCFSBurstVal := calcStaticCPUBurstVal(container, burstCfg)
		containerDir, burstPathErr := koordletutil.GetContainerCgroupParentDir(podMeta.CgroupDir, containerStat)
		if burstPathErr != nil {
			klog.Warningf("get container dir %s/%s/%s failed, dir %v, error %v",
				pod.Namespace, pod.Name, containerStat.Name, containerDir, burstPathErr)
			continue
		}

		podCFSBurstVal += containerCFSBurstVal
		containerCFSBurstValStr := strconv.FormatInt(containerCFSBurstVal, 10)
		eventHelper := audit.V(3).Container(containerStat.Name).Reason("CPUBurst").Message("update container CPUBurst: %v", containerCFSBurstValStr)
		updater, err := resourceexecutor.DefaultCgroupUpdaterFactory.New(system.CPUBurstName, containerDir, containerCFSBurstValStr, eventHelper)
		if err != nil { // normally cpu burst resource not supported on current system
			klog.V(5).Infof("get cpu burst updater for container %s/%s/%s failed, maybe system unsupported, err: %v",
				pod.Namespace, pod.Name, containerStat.Name, err)
			continue
		}
		updated, err := b.executor.Update(true, updater)
		if err != nil && system.IsResourceUnsupportedErr(err) {
			klog.V(5).Infof("update container %v/%v/%v cpu burst failed, cfs burst not supported, dir %v, info %v",
				pod.Namespace, pod.Name, containerStat.Name, containerDir, err)
		} else if err != nil {
			klog.V(4).Infof("update container %v/%v/%v cpu burst failed, dir %v, updated %v, err %v",
				pod.Namespace, pod.Name, containerStat.Name, containerDir, updated, err)
		} else {
			metrics.RecordContainerScaledCFSBurstUS(pod.Namespace, pod.Name, containerStat.ContainerID, containerStat.Name, float64(containerCFSBurstVal))
			klog.V(5).Infof("apply container %v/%v/%v cpu burst value successfully, dir %v, value %v",
				pod.Namespace, pod.Name, containerStat.Name, containerDir, containerCFSBurstVal)
		}
	} // end for containers

	podDir := podMeta.CgroupDir
	podCFSBurstValStr := strconv.FormatInt(podCFSBurstVal, 10)
	eventHelper := audit.V(3).Pod(podMeta.Pod.Namespace, podMeta.Pod.Name).Reason("CPUBurst").Message("update pod CFSQuota: %v", podCFSBurstValStr)
	updater, err := resourceexecutor.DefaultCgroupUpdaterFactory.New(system.CPUBurstName, podDir, podCFSBurstValStr, eventHelper)
	if err != nil { // normally cpu burst resource not supported on current system
		klog.V(5).Infof("get cpu burst updater for pod %s/%s failed, maybe system unsupported, err: %v",
			pod.Namespace, pod.Name, err)
		return
	}
	updated, err := b.executor.Update(true, updater)
	if err != nil && system.IsResourceUnsupportedErr(err) {
		klog.V(5).Infof("update pod %v/%v cpu burst failed, cfs burst not supported, dir %v, info %v",
			pod.Namespace, pod.Name, podDir, err)
	} else if err != nil {
		klog.V(4).Infof("update pod %v/%v cpu burst failed, dir %v, updated %v, err %v",
			pod.Namespace, pod.Name, podDir, updated, err)
	} else {
		klog.V(5).Infof("apply pod %v/%v cpu burst value successfully, dir %v, value %v",
			pod.Namespace, pod.Name, podDir, podCFSBurstValStr)
	}
}
```

这段逻辑其实很简单，他们的做法很暴力，直接将 koordinator 跑了 daemon，直接更新了 CGroup 的值，然后通过 CRD/configmap/annotation 来控制是否开启 CPU Burst。同时对于低版本的内核，通过调整 period 和 quota 来实现类似 burst 的效果。。

不得不说，的确是实现了目标，但是缺点也很明显，实际上是破坏了 Kubernetes 对于资源的调度。路子很野。

那么我们接下来来聊聊我们的几种实现的思路

#### 在 kubelet config 中新增配置来实现

首先大家肯定清楚，在 Kubelet 中存在两种 CPU Manager Policy

1. None
2. Static

后者对于 Guaranteed 类型 QoS 的 Pod 可以进行绑核操作，我们可以通过在 Node 打上 Label ，然后利用 NodeSelector 和亲和反亲和之类的工具来完成 Pod 的调度

那么同理，我们可以类似在 Kubernetes 中新增一个 CPU Manager Policy 的策略，叫作 Burst，然后新增一个配置字段 BurstQuotaPercentage。这个字段决定了我们为 Burstable 类型的 Pod，新增 BurstQuotaPercentage * cpu.cfs_quota_us 的 cpu.cfs_burst_us 的时间。

这样的好处有这样几个

1. 语义清晰，和 Kubelet 的 CPU Manager Policy 保持了一致
2. 实现相对简单，而且对于混合节点（多版本内核，多 containerd 版本）支持较好（可以在启动时候进行检查，如果不支持，就不启动这个策略）

但是缺点也很明显

1. 和 Static 的策略一样，使用起来并不方便，需要用户自己去做 NodeSelector 的调度，实际上是破坏了一部分 Kubernetes 对于底层细节的封装

#### 在 resources 中新增字段来实现

这个方案核心在于调整 Resources 的语义，使其可以使用这样的方式来实现 CPU Burst

```yaml
resources:
    requests:
        cpu: 50m
        memory: 50Mi
    limits:
        cpu: 100m
        cpuBurst: 20%
        memory: 100Mi
```

这个方案的好处有这样几个

1. 使用起来足够简单，非常清晰明了
2. 调度粒度够细

但是缺点也很明显

1. 语义上的不对称，因为 CPUBurst 是对于 limits 的限制，而不是 requests 的限制，那么这实际上破坏了现有语义的对称性。
2. 调度上存在一个歧义：对于混合部署的场景，如果内核或者 containerd 版本不支持的话，那么我们这个 Pod 是放弃 Burst 还是调度失败？同时我们的调度器是否应该去感知底层内核和 CPU 版本？这又会带来一个抽象泄漏的问题、
3. 只支持 Pod 级别的 Burst 太细了

#### 通过 annotation 以及 CRD 来实现

实际上类似于阿里已有的方案，我们已知 Kubernetes 存在一个 PodDistruptionBudget 的 CRD

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: zk-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: zookeeper
```

那么我们实际上也可以设计一个类似的 CPUBurstConfig 的 CRD 来实现

```yaml
apiVersion: policy/v1
kind: CPUBurstConfig
metadata:
  name: zk-pdb
spec:
  QuotaPercentage: 20%
  selector:
    matchLabels:
      app: zookeeper
```

同时我们也支持通过 annotation 来进行配置（因为 namespace crd 最终会转化为 Pod 上的 annotation）

那么这样的方案很明显

1. 规避了 resources 方案带来的语义不对称问题
2. 我们既可以实现 namespace 级别的多种 Burst 策略，也可以基于 Pod annotation 来实现更细粒度的配置

但是缺点很明显，和 resources 方案差不多，会带来一个抽象泄漏的问题

1. 我们的调度器是否应该去感知底层内核和 CPU 版本？
2. 我们 kubelet 是否应该去读取 Pod 的 annotation 来进行操作？

差不多就这些吧

## 总结

这篇水文差不多就到这里了，算是对于我自己想做的一个 KEP 的一些设计思考吧。不过有一说一，各种 tradeoff 实在太难做了。属实麻了。差不多就这样吧。改天有空再水点其余的文章吧。

## Reference

<div id="refer-anchor-1"></div>

- [1]. [https://lore.kernel.org/lkml/5371BD36-55AE-4F71-B9D7-B86DC32E3D2B@linux.alibaba.com/](https://lore.kernel.org/lkml/5371BD36-55AE-4F71-B9D7-B86DC32E3D2B@linux.alibaba.com/)

<div id="refer-anchor-2"></div>

- [2]. [https://github.com/koordinator-sh/koordinator](https://github.com/koordinator-sh/koordinator)
