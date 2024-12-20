# REST API Documentation

## Overview

The REST API provides endpoints for managing payment channels, payments, and atomic swaps. It follows RESTful principles and uses JSON for request and response payloads.

## Base URL

```
http://localhost:8080/api
```

## Authentication

Authentication is required for all endpoints. Use the `Authorization` header with a JWT token:

```
Authorization: Bearer <token>
```

## Endpoints

### Payments

#### Create Payment

Creates a new payment in a channel.

```http
POST /payments
```

**Request Body:**
```json
{
  "channelId": "string",
  "chainId": "number",
  "tokenId": "string",
  "amount": "string",
  "secret": "string",
  "timelock": "number",
  "encryptedData": "string"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "id": "string",
    "channelId": "string",
    "chainId": "number",
    "tokenId": "string",
    "amount": "string",
    "status": "pending",
    "secret": "string",
    "timelock": "number",
    "encryptedData": "string",
    "createdAt": "number",
    "updatedAt": "number"
  }
}
```

#### Get Payment

Retrieves a payment by ID.

```http
GET /payments/:paymentId
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "id": "string",
    "channelId": "string",
    "chainId": "number",
    "tokenId": "string",
    "amount": "string",
    "status": "string",
    "secret": "string",
    "timelock": "number",
    "encryptedData": "string",
    "createdAt": "number",
    "updatedAt": "number"
  }
}
```

#### List Channel Payments

Lists all payments in a channel.

```http
GET /channels/:channelId/payments
```

**Response:**
```json
{
  "status": "success",
  "data": [
    {
      "id": "string",
      "channelId": "string",
      "chainId": "number",
      "tokenId": "string",
      "amount": "string",
      "status": "string",
      "secret": "string",
      "timelock": "number",
      "encryptedData": "string",
      "createdAt": "number",
      "updatedAt": "number"
    }
  ]
}
```

#### Settle Payment

Settles a payment in a channel.

```http
POST /payments/:paymentId/settle
```

**Request Body:**
```json
{
  "channelId": "string",
  "chainId": "number",
  "tokenId": "string",
  "amount": "string",
  "secret": "string"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "id": "string",
    "channelId": "string",
    "chainId": "number",
    "tokenId": "string",
    "amount": "string",
    "status": "settled",
    "secret": "string",
    "timelock": "number",
    "encryptedData": "string",
    "createdAt": "number",
    "updatedAt": "number"
  }
}
```

#### Cancel Payment

Cancels a payment in a channel.

```http
POST /payments/:paymentId/cancel
```

**Request Body:**
```json
{
  "channelId": "string",
  "chainId": "number",
  "tokenId": "string",
  "amount": "string",
  "timelock": "number"
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "id": "string",
    "channelId": "string",
    "chainId": "number",
    "tokenId": "string",
    "amount": "string",
    "status": "cancelled",
    "secret": "string",
    "timelock": "number",
    "encryptedData": "string",
    "createdAt": "number",
    "updatedAt": "number"
  }
}
```

## Error Handling

### Error Response Format

```json
{
  "status": "error",
  "message": "string",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

### HTTP Status Codes

- `200 OK`: Request successful
- `201 Created`: Resource created
- `400 Bad Request`: Invalid request data
- `401 Unauthorized`: Missing or invalid authentication
- `403 Forbidden`: Insufficient permissions
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

## Request Validation

### Payment Request

- `channelId`: Required, non-empty string
- `chainId`: Required, positive integer
- `tokenId`: Required, non-empty string
- `amount`: Required, non-empty string
- `secret`: Optional string
- `timelock`: Required, positive integer
- `encryptedData`: Optional string

### Payment Settlement

- `channelId`: Required, non-empty string
- `chainId`: Required, positive integer
- `tokenId`: Required, non-empty string
- `amount`: Required, non-empty string
- `secret`: Required, non-empty string

### Payment Cancellation

- `channelId`: Required, non-empty string
- `chainId`: Required, positive integer
- `tokenId`: Required, non-empty string
- `amount`: Required, non-empty string
- `timelock`: Required, positive integer

## Examples

### Create Payment

```typescript
const response = await fetch('http://localhost:8080/api/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <token>',
  },
  body: JSON.stringify({
    channelId: '123',
    chainId: 1,
    tokenId: 'ETH',
    amount: '100',
    secret: '0x123',
    timelock: 3600,
    encryptedData: 'encrypted-data',
  }),
});

const data = await response.json();
console.log(data);
```

### Get Payment

```typescript
const response = await fetch('http://localhost:8080/api/payments/123', {
  headers: {
    'Authorization': 'Bearer <token>',
  },
});

const data = await response.json();
console.log(data);
```

### List Channel Payments

```typescript
const response = await fetch('http://localhost:8080/api/channels/123/payments', {
  headers: {
    'Authorization': 'Bearer <token>',
  },
});

const data = await response.json();
console.log(data);
```

### Settle Payment

```typescript
const response = await fetch('http://localhost:8080/api/payments/123/settle', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <token>',
  },
  body: JSON.stringify({
    channelId: '123',
    chainId: 1,
    tokenId: 'ETH',
    amount: '100',
    secret: '0x123',
  }),
});

const data = await response.json();
console.log(data);
```

### Cancel Payment

```typescript
const response = await fetch('http://localhost:8080/api/payments/123/cancel', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <token>',
  },
  body: JSON.stringify({
    channelId: '123',
    chainId: 1,
    tokenId: 'ETH',
    amount: '100',
    timelock: 3600,
  }),
});

const data = await response.json();
console.log(data);
```

## Best Practices

1. **Authentication**
   - Always use HTTPS in production
   - Keep tokens secure
   - Implement token refresh
   - Use proper token expiration

2. **Error Handling**
   - Handle all error cases
   - Provide meaningful error messages
   - Include field-level validation errors
   - Log errors appropriately

3. **Request Validation**
   - Validate all input data
   - Sanitize user input
   - Use proper data types
   - Handle edge cases

4. **Response Format**
   - Use consistent response format
   - Include status and data fields
   - Handle pagination properly
   - Include metadata when needed

5. **Security**
   - Implement rate limiting
   - Use input validation
   - Implement proper authentication
   - Follow security best practices 