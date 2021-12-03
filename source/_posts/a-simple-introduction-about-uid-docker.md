---
title: 简单聊聊容器中的 UID 中的一点小坑
type: tags
date: 2021-12-03 21:00:00
tags: [编程,Linux,笔记,水文]
categories: [编程,Linux]
toc: true
---

今天不太舒服，在家请假了一天。突然想起最近因为一些小问题，看了下关于容器中 UID 的东西。所以简单来聊聊这方面的东西。算个新手向的文章

<!--more-->

## 开篇

最近帮 FrostMing 把他的 [tokei-pie-cooker](https://github.com/frostming/tokei-pie-cooker) 部署到我的 K8S 上做成一个 SaaS 服务。Frost 最开始给我了一个镜像地址。然后我啪的一下复制粘贴了一个 Deployment 出来

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tokei-pie
  namespace: tokei-pie
  labels:
    app: tokei-pie
spec:
  replicas: 12
  selector:
    matchLabels:
      app: tokei-pie
  template:
    metadata:
      labels:
        app: tokei-pie
    spec:
      containers:
      - name: tokei-pie
        image: frostming/tokei-pie-cooker:latest
        imagePullPolicy: Always
        resources:
          limits:
            cpu: "1"
            memory: "2Gi"
            ephemeral-storage: "3Gi"
          requests:
            cpu: "500m"
            memory: "500Mi"
            ephemeral-storage: "1Gi"
        securityContext:
          allowPrivilegeEscalation: false
          runAsNonRoot: true
```

啪的一下，很快嘛，很简单对吧，限制下 Storage 用量，限制一下 NonRoot ，以免我被人打穿。Fine，`kubectl apply -f` 一下。Ops，

```text
Error: container has runAsNonRoot and image has non-numeric user (tokei), cannot verify user is non-root (pod: "tokei-pie-6c6fd5cb84-s4bz7_tokei-pie(239057ea-fe47-40a9-8041-966c65344a44)", container: tokei-pie)
```

噢，被 K8$ 拦截了，拦截点在 `pkg/kubelet/kuberruntime/security_context_others.go` 中。

```go
func verifyRunAsNonRoot(pod *v1.Pod, container *v1.Container, uid *int64, username string) error {
	effectiveSc := securitycontext.DetermineEffectiveSecurityContext(pod, container)
	// If the option is not set, or if running as root is allowed, return nil.
	if effectiveSc == nil || effectiveSc.RunAsNonRoot == nil || !*effectiveSc.RunAsNonRoot {
		return nil
	}

	if effectiveSc.RunAsUser != nil {
		if *effectiveSc.RunAsUser == 0 {
			return fmt.Errorf("container's runAsUser breaks non-root policy (pod: %q, container: %s)", format.Pod(pod), container.Name)
		}
		return nil
	}

	switch {
	case uid != nil && *uid == 0:
		return fmt.Errorf("container has runAsNonRoot and image will run as root (pod: %q, container: %s)", format.Pod(pod), container.Name)
	case uid == nil && len(username) > 0:
		return fmt.Errorf("container has runAsNonRoot and image has non-numeric user (%s), cannot verify user is non-root (pod: %q, container: %s)", username, format.Pod(pod), container.Name)
	default:
		return nil
	}
}
```

简而言之，K8$ 先会从镜像的 manifact 中拿镜像的 Runing Username. 如果你镜像里有设置 Runing Username 且你设置了 runAsNoneRoot ，同时你没设置 Run uid，那么会报错。Make Sense，如果你指定的用户名的 uid 是0，那么实际上还是打穿了 SecurityContext 的限制

找 Frost 要了下他的 Dockerfile，如下

```Dockerfile
FROM python:3.10-slim

RUN useradd -m tokei
USER tokei

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY templates /app/templates
COPY app.py .
COPY gunicorn_config.py .

ENV PATH="/home/tokei/.local/bin:$PATH"
EXPOSE 8000
CMD ["gunicorn", "-c", "gunicorn_config.py"]
```

OK, 平平淡淡，没有异常。OK，那我啪的一下改了 Deployment，新版如下

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tokei-pie
  namespace: tokei-pie
  labels:
    app: tokei-pie
spec:
  replicas: 12
  selector:
    matchLabels:
      app: tokei-pie
  template:
    metadata:
      labels:
        app: tokei-pie
    spec:
      containers:
      - name: tokei-pie
        image: frostming/tokei-pie-cooker:latest
        imagePullPolicy: Always
        resources:
          limits:
            cpu: "1"
            memory: "2Gi"
            ephemeral-storage: "3Gi"
          requests:
            cpu: "500m"
            memory: "500Mi"
            ephemeral-storage: "1Gi"
        securityContext:
          allowPrivilegeEscalation: false
          runAsNonRoot: true
          runAsUser: 10086
```

这里选了我自己的 Magic Number， 10086，这下总没问题了吧，我又 duang 的一下执行了 `kubectl apply -f`。Oooops，船新的报错

```text
/usr/local/bin/python: can't open file '/home/tokei/.local/bin/gunicorn': [Errno 13] Permission denied
```

OK，那我抛弃我的 Magic Number，换成传说中的数字，1000 来看一下。OK，Works！

那么这一切到底是为什么呢？那么接下来小编会来告诉你（XD

## 简单的介绍，完整的快乐

### 容器中的 UID

首先讲一点前置的知识。首先在 Linux 中的 UID 分配规律。首先在一个 Linux UserNamespace 中，UID 默认的范围是从 0 - 60000。其中 UID 0 是 Root 的保留 UID。从理论上来讲，用户 UID/GID 的创建的范围是从 1 到 60000

但是实际上可能会更复杂一些，通常各发行版的内置的一些服务，可能会自带一些特殊的用户，比如经典的 www-data （之前没事喜欢搭博客的同学对这个肯定不陌生）。所以实践中，一个 User Namespace 内，一个 UID 的起始，通常是 500 或者 1000。具体的设置，取决于一个特殊文件的设置，[login.defs](https://man7.org/linux/man-pages/man5/login.defs.5.html)，路径是 `/etc/login.defs`

官方文档中描述如下：

> Range of user IDs used for the creation of regular users by useradd or newusers. The default value for UID_MIN (resp.  UID_MAX) is 1000 (resp. 60000).

在我们调用 [`useradd`](https://man7.org/linux/man-pages/man8/useradd.8.html) 来在构建 Dockerfile 时添加用户。这个时候，在相关操作执行完毕后，会在 [`/etc/passwd`](https://linux.die.net/man/5/passwd) 这个特殊文件中添加对应的用户信息。以 Frost 的 Dockerfile 为例，最终的 passwd 文件内容如下

```text
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
sys:x:3:3:sys:/dev:/usr/sbin/nologin
sync:x:4:65534:sync:/bin:/bin/sync
games:x:5:60:games:/usr/games:/usr/sbin/nologin
man:x:6:12:man:/var/cache/man:/usr/sbin/nologin
lp:x:7:7:lp:/var/spool/lpd:/usr/sbin/nologin
mail:x:8:8:mail:/var/mail:/usr/sbin/nologin
news:x:9:9:news:/var/spool/news:/usr/sbin/nologin
uucp:x:10:10:uucp:/var/spool/uucp:/usr/sbin/nologin
proxy:x:13:13:proxy:/bin:/usr/sbin/nologin
www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin
backup:x:34:34:backup:/var/backups:/usr/sbin/nologin
list:x:38:38:Mailing List Manager:/var/list:/usr/sbin/nologin
irc:x:39:39:ircd:/run/ircd:/usr/sbin/nologin
gnats:x:41:41:Gnats Bug-Reporting System (admin):/var/lib/gnats:/usr/sbin/nologin
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
_apt:x:100:65534::/nonexistent:/usr/sbin/nologin
tokei:x:1000:1000::/home/tokei:/bin/sh
```

那么构建文件结束后，我们来看一下我们常见的容器运行时之一的 Docker 对此相关的处理。

这里还要科普一点前置的知识，现在 Docker 实际上只能算一个 Daemon+CLI，它核心的功能是调用其背后的 containerd。而 containerd 最终通过 runc 来创建相关的容器

那我们这里看一下 runc 对此相关的处理

在 runc 创建容器的时候，会调用 `runc/libcontainer/init_linux.go.finalizeNamespace` 这个函数完成一些设置，而在这个函数中，会调用 `runc/libcontainer/init_linux.go.setupUser` 这个函数来完成 Exec User 的设置，我们来看下源码

```go
func setupUser(config *initConfig) error {
	// Set up defaults.
	defaultExecUser := user.ExecUser{
		Uid:  0,
		Gid:  0,
		Home: "/",
	}

	passwdPath, err := user.GetPasswdPath()
	if err != nil {
		return err
	}

	groupPath, err := user.GetGroupPath()
	if err != nil {
		return err
	}

	execUser, err := user.GetExecUserPath(config.User, &defaultExecUser, passwdPath, groupPath)
	if err != nil {
		return err
	}

	var addGroups []int
	if len(config.AdditionalGroups) > 0 {
		addGroups, err = user.GetAdditionalGroupsPath(config.AdditionalGroups, groupPath)
		if err != nil {
			return err
		}
	}

	// Rather than just erroring out later in setuid(2) and setgid(2), check
	// that the user is mapped here.
	if _, err := config.Config.HostUID(execUser.Uid); err != nil {
		return errors.New("cannot set uid to unmapped user in user namespace")
	}
	if _, err := config.Config.HostGID(execUser.Gid); err != nil {
		return errors.New("cannot set gid to unmapped user in user namespace")
	}

	if config.RootlessEUID {
		// We cannot set any additional groups in a rootless container and thus
		// we bail if the user asked us to do so. TODO: We currently can't do
		// this check earlier, but if libcontainer.Process.User was typesafe
		// this might work.
		if len(addGroups) > 0 {
			return errors.New("cannot set any additional groups in a rootless container")
		}
	}

	// Before we change to the container's user make sure that the processes
	// STDIO is correctly owned by the user that we are switching to.
	if err := fixStdioPermissions(config, execUser); err != nil {
		return err
	}

	setgroups, err := ioutil.ReadFile("/proc/self/setgroups")
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	// This isn't allowed in an unprivileged user namespace since Linux 3.19.
	// There's nothing we can do about /etc/group entries, so we silently
	// ignore setting groups here (since the user didn't explicitly ask us to
	// set the group).
	allowSupGroups := !config.RootlessEUID && string(bytes.TrimSpace(setgroups)) != "deny"

	if allowSupGroups {
		suppGroups := append(execUser.Sgids, addGroups...)
		if err := unix.Setgroups(suppGroups); err != nil {
			return err
		}
	}

	if err := system.Setgid(execUser.Gid); err != nil {
		return err
	}
	if err := system.Setuid(execUser.Uid); err != nil {
		return err
	}

	// if we didn't get HOME already, set it based on the user's HOME
	if envHome := os.Getenv("HOME"); envHome == "" {
		if err := os.Setenv("HOME", execUser.Home); err != nil {
			return err
		}
	}
	return nil
}

```

大家看注释应该差不多能理解这段代码在干啥，在这段代码将会调用 `runc/libcontainer/user/user.go.GetExecUserPath` 和 `runc/libcontainer/user/user.go.GetExecUser` 来获取 exec 时的 UID，我们来看一下这块的实现（下面代码我精简了一部（

```go
func GetExecUser(userSpec string, defaults *ExecUser, passwd, group io.Reader) (*ExecUser, error) {
	if defaults == nil {
		defaults = new(ExecUser)
	}

	// Copy over defaults.
	user := &ExecUser{
		Uid:   defaults.Uid,
		Gid:   defaults.Gid,
		Sgids: defaults.Sgids,
		Home:  defaults.Home,
	}

	// Sgids slice *cannot* be nil.
	if user.Sgids == nil {
		user.Sgids = []int{}
	}

	// Allow for userArg to have either "user" syntax, or optionally "user:group" syntax
	var userArg, groupArg string
	parseLine([]byte(userSpec), &userArg, &groupArg)

	// Convert userArg and groupArg to be numeric, so we don't have to execute
	// Atoi *twice* for each iteration over lines.
	uidArg, uidErr := strconv.Atoi(userArg)
	gidArg, gidErr := strconv.Atoi(groupArg)

	// Find the matching user.
	users, err := ParsePasswdFilter(passwd, func(u User) bool {
		if userArg == "" {
			// Default to current state of the user.
			return u.Uid == user.Uid
		}

		if uidErr == nil {
			// If the userArg is numeric, always treat it as a UID.
			return uidArg == u.Uid
		}

		return u.Name == userArg
	})

    if err != nil && passwd != nil {
		if userArg == "" {
			userArg = strconv.Itoa(user.Uid)
		}
		return nil, fmt.Errorf("unable to find user %s: %v", userArg, err)
	}

	var matchedUserName string
	if len(users) > 0 {
		// First match wins, even if there's more than one matching entry.
		matchedUserName = users[0].Name
		user.Uid = users[0].Uid
		user.Gid = users[0].Gid
		user.Home = users[0].Home
	} else if userArg != "" {
		// If we can't find a user with the given username, the only other valid
		// option is if it's a numeric username with no associated entry in passwd.

		if uidErr != nil {
			// Not numeric.
			return nil, fmt.Errorf("unable to find user %s: %v", userArg, ErrNoPasswdEntries)
		}
		user.Uid = uidArg

		// Must be inside valid uid range.
		if user.Uid < minID || user.Uid > maxID {
			return nil, ErrRange
		}

		// Okay, so it's numeric. We can just roll with this.
	}
}
```

这里看着很复杂，实际上总结下来就这样

1. 首先从 `/etc/passwd` 读取已知的所有的用户

2. 如果用户启动时传入的是用户名，那么判断是否有用户名和启动参数传入的相等，没有则启动失败

3. 如果用户启动传入的是 UID，那么如果在已知用户中有对应的用户，那么设置为该用户。如果没有，则将进程的 UID 设置为传入的 UID

4. 如果用户什么都没传入，那么以 `/etc/passwd` 中第一个用户来作为 exec 用户。默认情况下第一个用户通常是指 UID 为 0 的 root 用户。

OK 那么回到我们的 Deployment 中，那我们不难得出如下的结论

1. 如果我们没有设置 runAsUser ，且镜像里也没指定启动用户，那么我们容器中的进程将以当前 user namespace 中 uid 为 0 的 root 用户启动

2. 如果在 Dockerfile 中设定了启动时的用户，且没有设置 runAsUser，那么将以我们在 Dockerfile 中的用户启动

3. 如果我们设置了 runAsUser 且 Dockerfile 中也指定了相关的用户，那么将以 runAsUser 所指定的 UID 启动进程

OK 那么，到这里看似问题解决了。但是这里有个新的疑问。通常来说，我们创建文件之类的操作，默认的权限都是 `755` ，即对于非当前用户，也非当前用户组内的成员，有可读可执行权限。按道理说不应该出现前文所说的 `[Errno 13] Permission denied` 情况。

我进容器看了下报错的文件，的确也和我估计的一样，是 755 权限

![gunicorn.py](https://user-images.githubusercontent.com/7054676/144605351-630025e7-33a7-421e-b471-cb4cc5a217fe.png)

那么问题出在哪呢？问题出在 `~/.local/` 这个文件夹，

![~/.local](https://user-images.githubusercontent.com/7054676/144605509-1caf1ac5-85a9-406d-8a7c-5f6714dca6f3.png)

是的没错，这里的 `.local` 是 700 权限，即对于非当前用户，也非当前用户组内的成员，没有对当前目录的可执行权限。这里大家可能有点迷惑，目录的可执行权限是什么？这里引用下官方文档 [Understanding Linux File Permissions](https://www.linux.com/training-tutorials/understanding-linux-file-permissions/) 中的描述

> execute – The Execute permission affects a user’s capability to execute a file or view the contents of a directory.

OK，好吧，如果没有对应的目录的可执行权限，那么我们也没法执行该目录里的文件，即便我们有文件的可执行权限。

而我这里翻了一下 pip 的源码。发现 pip 在用户态安装的时候，如果不存在 .local 目录，那么会创建 .local 目录并将权限设置为 700。

OK 到这里我们的整个问题的因果链就已经完全建立了

> 在 dockerfile 中创建并设置用户 tokei，uid 1000 -> pip 创建了 700 的 .local， .local 归属 UID 1000 的用户-> 我们 runAsUser 设置为 非 1000 的数字 -> 无 .local 的可执行权限 -> 报错

说实话，我能理解 pip 为什么这么设计，但是我觉得这样的设计是有一点 broke 了一些约定俗成的规矩的，其合理性有待商榷

## 总结

这个问题其实不算难查，但是发生的位置是我有点没有想到的，从我的角度来看，归根结底还是在与 pip 不遵守基本法造成的23333

这里留个题目大家有兴趣可以思考下。我们都知道 Docker 有个命令是 `docker cp` 是从宿主机往运行的容器中拷贝文件/从容器中往宿主机中拷贝文件。有个参数是 `-a` ，即保留原文件的 UID/GID，那么如果我们用这个参数从宿主机/容器往容器/宿主机中拷贝文件，那么我们 ls -lh 时，可以看到怎样的 User/UserGroup 信息。

OK，这篇水文就先写到这里，写水文真快乐。周末要是有时间的话，可以再写个水文简单聊聊一个关于最近遇到的一个很有趣的根据特征封锁 SSL 流量的手法分析

好了，溜了溜了

