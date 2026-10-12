此 Run 在迭代初期冻结输入。随后实际浏览器发现显式 cancel 只匹配麦克风 Session，顶部自动播报的 readSessionId 未被取消；live.json 保存取消失败和迟到摘要。另发现客户端远程命名空间需显式 inject。修复与测试夹具调整后源码已变化，本 Run 不代表最终源码；不改写 inputs.lock.json，以新 Run 重新冻结并验证。
