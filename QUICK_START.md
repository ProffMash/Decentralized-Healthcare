# Quick Start: Blockchain Hashing for Medical Records

## 5-Minute Setup

### Prerequisites
- Django server running
- React client running
- Python packages already installed (web3, hashlib included)

### Step 1: Apply Database Migrations (2 minutes)

```bash
cd server
python manage.py makemigrations hms
python manage.py migrate hms
```

Expected output:
```
Applying hms.XXXX_add_blockchain_fields...
```

### Step 2: Restart Server (1 minute)

```bash
# If running with runserver
python manage.py runserver

# If using another server, restart it
```

### Step 3: Test It (2 minutes)

1. Open the application in browser
2. Create a new patient or diagnosis
3. View the details - scroll down to see the "Blockchain Verification" section
4. You should see a blue box with a record hash like: `0x7a9c4e8f...`

Done! 🎉

## What You'll See

### In Patient Details
```
┌─────────────────────────────────────────┐
│ Blockchain Verification                 │
│ Record Hash                             │
│ 0x7a9c4e8fd42c1b3e5f2a1d4c6b8e9a2f...   │
│ Transaction Hash                        │
│ (empty if blockchain not configured)    │
└─────────────────────────────────────────┘
```

### In Diagnosis Details
Same blockchain section shows record integrity hash

### In Lab Results
Each result shows its blockchain hash for verification

## How It Works (Simple)

1. **Record Created** → Automatically hashed with SHA-256
2. **Hash Stored** → Saved in database
3. **UI Shows Hash** → Displayed in detail views
4. **Optional: On Blockchain** → If configured, also on-chain

## Optional: Enable Blockchain

If you want to store hashes on a blockchain:

```bash
# Set these environment variables
export BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545
export BLOCKCHAIN_PRIVATE_KEY=your_private_key_here
```

Then restart the server. The system will try to send each hash to the blockchain.

## Common Questions

**Q: What if blockchain fails?**
A: The hash is still computed and stored locally. The system continues working.

**Q: Are the hashes really SHA-256?**
A: Yes, 256-bit cryptographic hashes. 0x-prefixed hex format.

**Q: Can I verify a hash?**
A: Yes! Re-serialize the record the same way and recompute the hash. If it matches, the record hasn't been tampered with.

**Q: Do I need blockchain?**
A: No. Hashing works perfectly without it. Blockchain is optional for additional integrity verification.

**Q: Will this slow things down?**
A: No. Hash computation takes < 1ms per record. Negligible impact.

**Q: Can I see old records' hashes?**
A: Only newly created/updated records will have hashes (created after migration). Existing records won't have hashes unless edited.

## Files Changed

**Backend:**
- `server/hms/models.py` - Added hash fields
- `server/hms/blockchain_service.py` - New hashing service
- `server/hms/serializers.py` - Added hash fields to responses
- `server/hms/views.py` - Added hash generation

**Frontend:**
- `client/src/types/index.ts` - Added hash properties
- `client/src/components/shared/PatientManagement.tsx` - Shows hashes
- `client/src/components/shared/DiagnosesManagement.tsx` - Shows hashes
- `client/src/components/shared/LaboratoryManagement.tsx` - Shows hashes

## Next Steps

1. **View Details** to see blockchain hashes
2. **Read IMPLEMENTATION_SUMMARY.md** for overview
3. **Read BLOCKCHAIN_IMPLEMENTATION.md** for deep dive
4. **(Optional) Set up blockchain** for on-chain verification

## Troubleshooting

### Migration fails?
```bash
# Check migrations status
python manage.py showmigrations hms

# Try again with verbose output
python manage.py migrate hms --verbosity 2
```

### Hashes not showing?
1. Make sure migrations are applied
2. Create a NEW record (existing ones won't have hashes)
3. View the details page
4. Scroll to bottom - should see blue "Blockchain Verification" box

### Blockchain not working?
This is OK! It's optional. Hashes still compute locally.

To see errors:
```bash
# Check Django logs
tail -f logs/django.log

# Verify environment variables
echo $BLOCKCHAIN_RPC_URL
echo $BLOCKCHAIN_PRIVATE_KEY
```

## Reference Links

- **Implementation Details**: See `BLOCKCHAIN_IMPLEMENTATION.md`
- **Summary**: See `IMPLEMENTATION_SUMMARY.md`
- **Models**: `server/hms/models.py`
- **Service**: `server/hms/blockchain_service.py`

## Support

For detailed documentation, see:
- `BLOCKCHAIN_IMPLEMENTATION.md` - Complete guide
- `IMPLEMENTATION_SUMMARY.md` - Overview of changes
- This file - Quick start guide

---

**That's it!** Your medical records now have blockchain-based integrity verification. 🔐
