# Stripe API 快速入门

## 概述
Stripe 是一个在线支付处理平台，提供完整的 API 来处理支付、订阅和退款。

## 安装

```bash
npm install stripe
```

## 初始化

```javascript
const stripe = require('stripe')('sk_test_xxx');
```

## 创建支付意图

```javascript
const paymentIntent = await stripe.paymentIntents.create({
  amount: 2000,
  currency: 'usd',
  automatic_payment_methods: { enabled: true },
});
```

## 常见错误

- CardDeclined: 卡被拒，检查卡号或使用测试卡
- InsufficientFunds: 余额不足
- InvalidRequest: 参数错误，检查 API 版本

## 最佳实践

- 始终使用 idempotency key 防止重复扣款
- Webhook 验证签名防止伪造请求
- 金额单位是分（cents），2000 = $20.00
