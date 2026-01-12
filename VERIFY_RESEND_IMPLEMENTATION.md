# Verify & Resend Implementation - Quick Reference

## Overview

The `verify` and `resend` functions are **fully implemented** in both frontend and backend. Here's how they work:

---

## 📋 Verify Function

### Frontend (Audits.tsx)
```typescript
const verify = async (id: number) => {
  setActionLoading(prev => ({ ...prev, [id]: 'verify' }));
  try {
    let res;
    try {
      res = await api.get(`/audits/${id}/verify/`);
    } catch (err: any) {
      if (err?.response?.status === 405) {
        res = await api.post(`/audits/${id}/verify/`);
      } else {
        throw err;
      }
    }
    await fetchAudits();
    const txHash = res?.data?.tx_hash;
    const blockNumber = res?.data?.block_number;
    alert(`✓ Verified on Blockchain\nChain: ${blockchainStatus.network}\nBlock: ${blockNumber || 'Pending'}\nTx: ${txHash || '—'}`);
  } catch (e: any) {
    console.error('verify failed', e);
    alert((e?.response?.data?.detail) || 'Verification failed');
  } finally {
    setActionLoading(prev => ({ ...prev, [id]: null }));
  }
};
```

### What It Does
1. Sets loading state for the button
2. Attempts GET request to `/audits/{id}/verify/`
3. Falls back to POST if GET returns 405 (Method Not Allowed)
4. Fetches updated audits to refresh the table
5. Shows alert with blockchain confirmation details:
   - Network name
   - Block number (or "Pending" if not confirmed)
   - Transaction hash
6. Handles errors gracefully with error messages

### Backend Endpoint (Django)
```python
@action(detail=True, methods=['get'])
def verify(self, request, pk=None):
    """Verify if a record hash exists on the blockchain."""
    try:
        audit = self.get_object()
    except Exception:
        return Response({'detail': 'Not found'}, status=404)

    try:
        from ..blockchain.web3_client import check_hash_on_chain, Web3, RPC_URL
        on_chain = check_hash_on_chain(audit.record_hash)
        
        # Get blockchain details
        w3 = Web3(Web3.HTTPProvider(RPC_URL))
        if w3.is_connected():
            current_block = w3.eth.block_number
        else:
            current_block = None
    except Exception as e:
        on_chain = False
        current_block = None

    return Response({
        'id': audit.id,
        'record_hash': audit.record_hash,
        'record_cid': audit.record_cid,
        'tx_hash': audit.tx_hash,
        'on_chain': bool(on_chain),
        'status': 'confirmed' if audit.tx_hash else 'pending',
        'block_number': getattr(audit, 'block_number', None),
        'created_at': audit.created_at,
    })
```

### What Happens
1. Retrieves the audit record
2. Checks if hash exists on blockchain via `check_hash_on_chain()`
3. Gets current blockchain block number if connected
4. Returns comprehensive response with:
   - Record hash
   - Transaction hash (if exists)
   - IPFS CID (if stored)
   - On-chain status
   - Status (confirmed/pending)
   - Block number
   - Creation timestamp

---

## 📤 Resend Function

### Frontend (Audits.tsx)
```typescript
const resend = async (id: number) => {
  setActionLoading(prev => ({ ...prev, [id]: 'resend' }));
  try {
    const res = await api.post(`/audits/${id}/resend/`);
    alert(`Resend tx: ${res?.data?.tx_hash || '—'}`);
    await fetchAudits();
  } catch (e: any) {
    console.error('resend failed', e);
    if (e?.response?.status === 503) {
      alert('Service unavailable: The backend is not running or the endpoint is down.');
    } else {
      alert(e?.response?.data?.detail || 'Resend failed');
    }
  } finally {
    setActionLoading(prev => ({ ...prev, [id]: null }));
  }
};
```

### What It Does
1. Sets loading state for the button
2. Posts to `/audits/{id}/resend/`
3. Shows the returned transaction hash
4. Refreshes audits to update the table
5. Handles specific errors:
   - 503: Service unavailable (blockchain not configured)
   - Other: Shows backend error message

### Backend Endpoint (Django)
```python
@action(detail=True, methods=['post'])
def resend(self, request, pk=None):
    """Attempt to resend the stored hash to the blockchain and update tx_hash."""
    try:
        audit = self.get_object()
    except Exception:
        return Response({'detail': 'Not found'}, status=404)

    try:
        from ..blockchain.web3_client import send_hash_transaction
    except Exception:
        return Response({'detail': 'Blockchain client not configured'}, status=503)

    try:
        tx = send_hash_transaction(audit.record_hash)
        if tx:
            audit.tx_hash = tx
            audit.save(update_fields=['tx_hash'])
            return Response({'tx_hash': tx})
        return Response({'detail': 'Transaction not sent (no private key configured?)'}, status=400)
    except Exception as e:
        return Response({'detail': f'Error sending transaction: {str(e)}'}, status=500)
```

### What Happens
1. Retrieves the audit record
2. Checks if blockchain client is available
3. Calls `send_hash_transaction()` to submit the hash to blockchain
4. If transaction succeeds:
   - Updates the audit record with tx_hash
   - Saves to database
   - Returns transaction hash
5. If transaction fails:
   - Returns error message with details

---

## 🔄 How They Work Together

### Typical Workflow

```
1. User clicks "Verify" button
   ↓
2. Frontend sends GET /audits/{id}/verify/
   ↓
3. Backend checks blockchain for hash
   ↓
4. Returns on_chain status and tx_hash
   ↓
5. Frontend shows alert with confirmation details
   ↓
6. User sees if record is confirmed

---

1. User clicks "Resend" button (for pending records)
   ↓
2. Frontend sends POST /audits/{id}/resend/
   ↓
3. Backend calls send_hash_transaction()
   ↓
4. Transaction sent to blockchain
   ↓
5. Returns new tx_hash
   ↓
6. Frontend updates audits table
   ↓
7. User sees new transaction hash
```

---

## 📊 Response Examples

### Verify Success Response
```json
{
  "id": 1,
  "record_hash": "0x8a2c7f4d1e9b3c6a5f2d8e1b4c7a9f3e2d5c8a1b3e6f9c2d5e8a1b4c7d0f3a6",
  "record_cid": null,
  "tx_hash": "0x742d33cc5627cbe320c0f49c4d2b7e4f...",
  "on_chain": true,
  "status": "confirmed",
  "block_number": 5234567,
  "created_at": "2024-01-12T10:30:00Z"
}
```

### Resend Success Response
```json
{
  "tx_hash": "0x9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a"
}
```

### Error Response (503)
```json
{
  "detail": "Blockchain client not configured"
}
```

### Error Response (400)
```json
{
  "detail": "Transaction not sent (no private key configured?)"
}
```

---

## 🧪 Testing Guide

### Test Verify Function

**Prerequisites**:
- Have at least one audit record
- Blockchain RPC endpoint configured

**Steps**:
1. Navigate to Audits page
2. Go to "On-Chain Records" tab
3. Click "✓ Verify" button on any record
4. Check alert shows:
   - ✓ Verified on Blockchain
   - Network name (e.g., "Sepolia Testnet")
   - Block number or "Pending"
   - Transaction hash

**Expected Results**:
- Button shows "Verifying..." while loading
- Alert appears with blockchain info
- Record refreshes in table
- Status updates if confirmed

---

### Test Resend Function

**Prerequisites**:
- Have a pending audit record (no tx_hash)
- Blockchain RPC + private key configured

**Steps**:
1. Navigate to Audits page
2. Go to "On-Chain Records" tab
3. Find a record with "⏳ Pending" status
4. Click "📤 Resend" button
5. Check alert shows new transaction hash

**Expected Results**:
- Button shows "Resending..." while loading
- Alert shows transaction hash
- Table refreshes
- Status changes from "Pending" to "Confirmed"
- Transaction hash now shows in table

---

## 🐛 Troubleshooting

### Verify Shows "Verification failed"
- **Cause**: Blockchain not connected or hash not found
- **Solution**: Check BLOCKCHAIN_RPC_URL is set correctly

### Resend Shows "Service unavailable"
- **Cause**: Backend not running or blockchain client issue
- **Solution**: 
  - Verify backend server is running
  - Check BLOCKCHAIN_PRIVATE_KEY is configured
  - Check blockchain node is accessible

### Resend Shows "Transaction not sent"
- **Cause**: Private key not configured
- **Solution**: Set BLOCKCHAIN_PRIVATE_KEY environment variable

### No response from endpoints
- **Cause**: Backend endpoint not registered
- **Solution**: Verify URLs are correct in hms/urls.py

---

## ✅ Implementation Status

- ✅ Frontend verify() function implemented
- ✅ Backend verify endpoint implemented
- ✅ Frontend resend() function implemented
- ✅ Backend resend endpoint implemented
- ✅ Error handling on both sides
- ✅ Loading states
- ✅ User feedback (alerts)
- ✅ Automatic refresh after action
- ✅ Proper HTTP methods (GET for verify, POST for resend)

---

## 🔗 Related Functions

### Other Button Actions
- `storeCid()` - Store IPFS CID on-chain
- `openBlockchainExplorer()` - Open Etherscan
- `openIPFSExplorer()` - Open IPFS gateway
- `copyToClipboard()` - Copy hash to clipboard

### Supporting Functions
- `fetchAudits()` - Refresh audit list
- `fetchBlockchainStatus()` - Get network info
- `pollTransactionStatus()` - Auto-check pending transactions

---

## 📝 Code Locations

**Frontend**:
- `client/src/pages/Audits.tsx` lines 171-219

**Backend**:
- `server/hms/views.py` lines 245-301

**URLs**:
- `server/hms/urls.py` - `/audits/{id}/verify/` and `/audits/{id}/resend/` routes

---

**Status**: ✅ FULLY IMPLEMENTED AND READY TO USE
