---
title: Swift 3 中的函数参数命名规范指北
type: tags
date: 2016-10-09 22:13:04
tags: [iOS,编程,Swift]
categories: [编程,翻译]
---
> * 原文地址：[Function Naming In Swift 3](http://inaka.net/blog/2016/09/16/function-naming-in-swift-3/)
* 原文作者：[Pablo Villar](https://twitter.com/volbap)
* 译文出自：[掘金翻译计划](https://github.com/xitu/gold-miner)
* 译者：[Zheaoli](https://github.com/Zheaoli)
* 校对者：[Kulbear](https://github.com/Kulbear), [Tuccuay](https://github.com/Tuccuay)

昨天，我开始将这个 [Jayme](http://inaka.net/blog/2016/05/09/meet-jayme/) 迁移到 Swift 3。这是我第一次将一个项目从 Swift 2.2 迁移至 Swift 3。说实话这个过程十分的繁琐，由于 Swift 3 在老版本基础上发生了很多比较大的改变，我不得不承认眼前这样一个事实，除了花费较多的时间以外，没有其余的捷径可走。不过这样的经历也带来一点好处：我对 Swift 3 的理解变得更为深入，对我来讲，这可能是最好的消息了。😃

在迁移代码的过程中，我需要做出很多的选择。更为蛋疼的是，整个迁移过程并不是修改代码那么简单，你还需要用耐心去一点点适应 Swift 3 中带来的新变化。某种意义上来讲，修改代码只是整个迁移过程的开始而已。

如果你已经决定将你的代码迁移到 Swift 3 ，我建议你去看看这篇[文章](http://www.jessesquires.com/migrating-to-swift-3/)来作为你万里长征的第一步。

如果一切顺利的话，在不久以后，我将回去写一篇博客来记录下整个迁移过程中的点点滴滴，包括我所作出的决定等等。但是眼前，我将会把注意力集中在一个非常非常重要的问题上：**怎样正确的编写函数签名**.
<!-- more -->

## 开篇

首先，让我们来看看在 Swift 3 与 Swift 2 相比函数命名方式的差异吧。

在 Swift 2 中，函数中的第一个参数的标签在调用时可以省略，这是为了遵循这样一个 [good ol' Objective-C conventions](https://developer.apple.com/library/content/documentation/Cocoa/Conceptual/CodingGuidelines/Articles/NamingMethods.html) 标准。比如我们可以这样写代码：

~~~Swift
    // Swift 2
    func handleError(error: NSError) { }
    let error = NSError()
    handleError(error) // Looks like Objective-C
~~~

在 Swift 3 中调用函数时，其实也是有办法省略第一个参数的标签的，但默认情况下不是这样：

~~~Swift
    // Swift 3
    func handleError(error: NSError) { }
    let error = NSError()
    handleError(error)  // Does not compile!
    // ⛔ Missing argument label 'error:' in call
~~~


当遇到这样的情况时，我们第一反应可能是下面这样的：

~~~Swift
    // Swift 3
    func handleError(error: NSError) { }
    let error = NSError()
    handleError(error: error)    
    // Had to write 'error' three times in a row!
    // My eyes already hurt 🙈
~~~

当然如果这样做，你肯定会很快意识到你的代码将将会变得有多坑爹。

如同前面所说的一样，在 Swift 3 中，我们是可以在调用函数时，将第一个参数的标签省略的，但是记住，你要去明确的告诉编译器这一点：

~~~Swift
    // Swift 3
    func handleError(_ error: NSError) { }
    // 🖐 Notice the underscore!
    let error = NSError()
    handleError(error)  // Same as in Swift 2
~~~

> 你可能在使用 Xcode 自带的迁移工具进行迁移时遇到这样的情况。

注意，在函数签名中的下划线的意思是：告诉编译器，我们在调用函数时第一个参数不需要外带标签。这样，我们可以按照 Swift 2 中的方式去调用函数。

此外，你需要意识到，Swift 3 之所以修改了函数编写方式，是为了保证其一致性与可读性：我们不在需要对不同的参数区别对待。我想这可能是你遇到的第一个问题。

好了，现在代码可以编译运行了，但是你必须知道，你需要反复的去阅读 [Swift 3 API design guidelines](https://swift.org/documentation/api-design-guidelines/) 一文。

> ☝️ 一点微小的人生经验：你需要随时去诵读 [Swift 3 API design guidelines](https://swift.org/documentation/api-design-guidelines/) 一文，这会为你解锁 Swift 开发的新体位。

## 第二步，精简你的代码

![Pruning](https://cloud.githubusercontent.com/assets/7054676/19221283/ef89dd06-8e72-11e6-97d4-d11f2f0a41db.jpg)

让我们再来看看之前的代码:

为了精简我们的代码，你可以将你的代码进行[修剪](https://github.com/apple/swift-evolution/blob/master/proposals/0005-objective-c-name-translation.md#prune-redundant-type-names)一番，比如去除函数名里的类型信息等。

~~~Swift
    // Swift 3
    func handle(_ error: NSError) { /* ... */ }
    let error = NSError()
    handle(error)   // Type name has been pruned
    // from function name, since it was redundant
~~~

如果你想让你的代码变得更短，更精悍，更明了的话，我给你们讲，作为一个钦定的开发者，一定要去反复诵读这篇 [Swift 3 API design guidelines](https://swift.org/documentation/api-design-guidelines/) 文章到可以默写为止。

要注意让函数的调用过程是清晰、明确的，我们根据以下两点来确定函数的的命名和参数：

*   我们知道函数的返回**类型**
*   我们知道参数所对应的类型（比如在上面这个例子中，我们毫无疑问的知道其参数所属的类型是 **NSError**）。

## 更多的一些问题

现在请睁大眼睛看清楚我们下面所讨论的东西。 ⚠️

上面我们所讲的东西并没有包括所有可能出现的情况，换句话说，你可能遇到这样一种特殊情况，即，一个参数的类型没有办法直观的体现其作用。

让我们考虑下面这样一种情况：

~~~Swift
    // Swift 2
    func requestForPath(path: String) -> URLRequest {  }
    let request = requestForPath("local:80/users")
~~~

如果你想将代码迁移到 Swift 3 ，那么根据已有的知识，你可能会这么做：

~~~Swift
    // Swift 3
    func request(_ path: String) -> URLRequest {  }
    let request = request("local:80/users")
~~~

讲真，这段代码看起来可读性很差，让我们稍微修改下：

~~~Swift
    // Swift 3
    func request(for path: String) -> URLRequest {  }
    let request = request(for: "local:80/users")
~~~

OK，现在看起来舒服多了，但是并没有解决我上面提到的问题。

在我们调用这个函数的时候，我们怎样很直观的知道我们需要给这个参数传递一个 Web Url 呢？你所能提前知道的是你需要传递一个 String 类型的变量进去，但是你并不清楚你需要传递一个 Web Url 进去。

同理，我们在一个大型项目中，我们需要很清楚的明白每个参数的作用所在，但是很明显，目前我们还没有解决这个大问题，比如:

*   你怎么知道一个 `String` 类型的变量代表着 Web Url。
*   你怎么知道一个 `Int` 类型的变量代表着 Http 状态码。`[String: String]`
*   你怎么知道一个 `[String: String]` 类型的变量代表着 Http Header。
*   等等...。

> ⚠️ 综上，我给你们一点微小的人生经验吧: **谨慎精简你的代码** ✄

回到代码上，我们可以给参数添加上相对应的标签来解决这个问题，好了看看下面这个代码：

~~~Swift
    func request(forPath path: String) -> URLRequest {  }
    let request = request(forPath: "local:80/users")
~~~

好了，现在代码看起来是不是**更清楚**，**可读性**更强了呢？ 🎉 恭喜~

![Hooray](http://inaka.net/assets/img/rick-hooray-confeti.gif)

> 讲真，看到这里其实你可以关闭浏览器了，但是事实上，下面才是最精华的部分。

好了，让我们来看看关于函数参命名的用词问题：

~~~Swift
    func request(forPath path: String) -> URLRequest {  }
    // The word 'path' appears twice
~~~

这段代码看起来不错，但是如果你想让其变得更好，那么请看接下来的部分。

## 你所不知道的小技巧

这个小技巧很简单：在上下文中反映参数的类型及作用，这样你就可以无脑的精简你的代码了。

![Prune with no mercy](http://inaka.net/assets/img/prune-with-no-mercy.gif)

呐，我们来看看下面这段代码。

~~~Swift
    typealias Path = String      // To the rescue!

    func request(for path: Path) -> URLRequest {  }
    let request = request(for: "local:80/users")
~~~

在这个例子中，参数的类型和参数的作用表达达成了一个完美的统一，因为你在上下文中为 `String` 赋予了一个别名叫做 `Path`。

现在，你的函数看起来还是依旧的精简，可读性较高，但是却不重复。

以此类推，你可以使用同样的方式来书写一些优美的代码，比如：

~~~Swift
    typealias Path = String
    typealias StatusCode = Int
    typealias HTTPHeader = [String: String]
    // etc...
~~~

如你所见，你可以尽情的写精简而优美的代码了。

不过，请记住，凡事走向极端便变了味了：这个小技巧会为你的代码添加额外的负担，特别是你们代码存在多重嵌套的情况下。因此请记住，如果你无脑的使用这样的小技巧的话，那么你可能会付出一些惨痛的代价。

## 结论

很多时候，你在使用　Swift 3 时，命名函数的时候你会遇到很多困难。

积累一些代码片段可能会帮助你很多：

~~~Swift
    func remove(at position: Index) -> Element {  }
    employees.remove(at: x)

    func remove(_ member: Element) -> Element?  {  }
    allViews.remove(cancelButton)

    func url(forPath path: String) -> URL {  }
    let url = url(forPath: "local:80/users")

    typealias Path = String // Alternative
    func url(for path: Path) -> URL {  }
    let url = url(for: "local:80/users")

    func entity(from dictionary: [String: Any]) -> Entity { /* ... */ }
    let entity = entity(from: ["id": "1", "name": "John"])
~~~
