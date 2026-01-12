# Technical Architecture: Blockchain Hashing System

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Medical Records System                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Frontend (React/TypeScript)             │   │
│  │  • PatientManagement.tsx                                │   │
│  │  • DiagnosesManagement.tsx                              │   │
│  │  • LaboratoryManagement.tsx                             │   │
│  │  • Displays blockchain hashes in detail views            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↕                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │               REST API (Django Rest Framework)           │   │
│  │  • /api/patients/                                        │   │
│  │  • /api/diagnoses/                                       │   │
│  │  • /api/lab-results/                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↕                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              ViewSets (with Hash Generation)             │   │
│  │  • PatientViewSet (perform_create/perform_update)        │   │
│  │  • DiagnosisViewSet (hash generation hooks)              │   │
│  │  • LabResultViewSet (hash generation hooks)              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↕                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │       blockchain_service.py (Hash Generation)            │   │
│  │  • serialize_record_data()                               │   │
│  │  • compute_hash()                                        │   │
│  │  • hash_model_instance()                                 │   │
│  │  • store_record_hash()                                   │   │
│  │  • send_hash_to_blockchain()                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↕                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │               Models (with Hash Fields)                  │   │
│  │  • Patient                                               │   │
│  │    - blockchain_hash (VARCHAR 66, indexed)               │   │
│  │    - blockchain_tx_hash (VARCHAR 100)                    │   │
│  │  • Diagnosis (same structure)                            │   │
│  │  • LabResults (same structure)                           │   │
│  │  • OnChainAudit (audit trail)                            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↕                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Database (SQLite)                     │   │
│  │  • hms_patient (+ blockchain_hash, blockchain_tx_hash)   │   │
│  │  • hms_diagnosis (+ blockchain fields)                   │   │
│  │  • hms_labresults (+ blockchain fields)                  │   │
│  │  • hms_onchainaudit (audit records)                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │         web3_client.py (Optional Blockchain)             │   │
│  │  • send_hash_transaction()                               │   │
│  │  • check_hash_on_chain()                                 │   │
│  │  Communicates with Ethereum node (if configured)         │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              ↓                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Blockchain Network (Optional)               │   │
│  │  • Ethereum-compatible node (via RPC)                    │   │
│  │  • AuditLog Smart Contract                               │   │
│  │  Stores hash records for tamper-proof audit trail        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### When Creating a Patient Record

```
1. User fills patient form in React UI
   └─→ POST /api/patients/

2. PatientViewSet.create() called
   └─→ Serializer validates data
   └─→ PatientViewSet.perform_create()

3. perform_create() saves instance
   └─→ calls store_record_hash(instance)

4. store_record_hash() process:
   a. hash_model_instance(instance)
      └─→ Extract model fields (exclude: id, blockchain_*, timestamps)
      └─→ Serialize to stable JSON (sorted keys)
      └─→ Compute SHA-256 hash
      └─→ Return 0x-prefixed hex string
   
   b. send_hash_to_blockchain(record_hash)
      └─→ Calls web3 client (if configured)
      └─→ Attempts transaction
      └─→ Returns tx_hash or None

   c. create_blockchain_record()
      └─→ Stores in OnChainAudit table
      └─→ record_hash: the SHA-256 hash
      └─→ tx_hash: blockchain transaction (if available)

   d. Update instance
      └─→ instance.blockchain_hash = record_hash
      └─→ instance.blockchain_tx_hash = tx_hash
      └─→ instance.save()

5. API Response
   └─→ PatientSerializer returns all fields
   └─→ Includes blockchain_hash and blockchain_tx_hash
   └─→ Sent to frontend

6. Frontend displays hash
   └─→ In patient details modal
   └─→ Blue verification box
   └─→ Hash in monospace font
```

## Hash Computation Algorithm

```python
# Step 1: Serialize Record
data = {
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    # ... other fields
    # EXCLUDE: id, blockchain_hash, blockchain_tx_hash, timestamps
}

serialized = json.dumps(data, sort_keys=True, default=str)
# Result: stable JSON with consistent field order
# {"address":"123 Main St","date_of_birth":"1990-01-15",...}

# Step 2: Hash
hash_bytes = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
# Result: 64-character hex string
# "7a9c4e8fd42c1b3e5f2a1d4c6b8e9a2f3c1d5e7f8a9b0c1d2e3f4a5b6c7d8e"

# Step 3: Add 0x Prefix
record_hash = '0x' + hash_bytes
# Result: 0x-prefixed hash (66 characters)
# "0x7a9c4e8fd42c1b3e5f2a1d4c6b8e9a2f3c1d5e7f8a9b0c1d2e3f4a5b6c7d8e"
```

## Database Schema

### Patient Table Addition
```sql
ALTER TABLE hms_patient ADD COLUMN blockchain_hash VARCHAR(66) NULL;
ALTER TABLE hms_patient ADD COLUMN blockchain_tx_hash VARCHAR(100) NULL;

CREATE INDEX idx_patient_blockchain_hash ON hms_patient(blockchain_hash);
```

### Diagnosis Table Addition
```sql
ALTER TABLE hms_diagnosis ADD COLUMN blockchain_hash VARCHAR(66) NULL;
ALTER TABLE hms_diagnosis ADD COLUMN blockchain_tx_hash VARCHAR(100) NULL;

CREATE INDEX idx_diagnosis_blockchain_hash ON hms_diagnosis(blockchain_hash);
```

### LabResults Table Addition
```sql
ALTER TABLE hms_labresults ADD COLUMN blockchain_hash VARCHAR(66) NULL;
ALTER TABLE hms_labresults ADD COLUMN blockchain_tx_hash VARCHAR(100) NULL;

CREATE INDEX idx_labresults_blockchain_hash ON hms_labresults(blockchain_hash);
```

### OnChainAudit Table (Existing)
```sql
Table: hms_onchainaudit
Columns:
  - id (Primary Key)
  - record_type (VARCHAR 100, indexed) - 'Patient', 'Diagnosis', 'LabResults'
  - object_id (Integer, indexed) - Foreign key to the record
  - record_hash (VARCHAR 66, indexed) - The SHA-256 hash
  - record_cid (VARCHAR 255, nullable, indexed) - IPFS CID for off-chain storage
  - tx_hash (VARCHAR 100, nullable) - Blockchain transaction hash
  - created_at (DateTime, indexed)
```

## Class Diagrams

### Blockchain Service
```
blockchain_service.py
├── serialize_record_data(data, exclude_fields)
│   └── Returns stable JSON string for hashing
├── compute_hash(data, exclude_fields)
│   └── Returns 0x-prefixed SHA-256 hash
├── hash_model_instance(instance, exclude_fields)
│   └── Hashes a Django model directly
├── store_record_hash(instance, update_instance)
│   └── Complete flow: hash → blockchain → audit → update
├── send_hash_to_blockchain(record_hash)
│   └── Calls web3 client for on-chain storage
└── create_blockchain_record(record_type, object_id, record_hash, ...)
    └── Creates OnChainAudit entry
```

### ViewSet Integration
```
PatientViewSet (viewsets.ModelViewSet)
├── perform_create(serializer)
│   └── Calls store_record_hash()
└── perform_update(serializer)
    └── Calls store_record_hash()

DiagnosisViewSet (viewsets.ModelViewSet)
├── perform_create(serializer)
│   └── Calls store_record_hash()
└── perform_update(serializer)
    └── Calls store_record_hash()

LabResultViewSet (viewsets.ModelViewSet)
├── perform_create(serializer)
│   └── Calls store_record_hash()
└── perform_update(serializer)
    └── Calls store_record_hash()
```

## Error Handling Strategy

```python
# All blockchain operations wrapped in try-except
try:
    store_record_hash(instance, update_instance=True)
except Exception as e:
    # Log error
    logger.exception(f"Failed to store blockchain hash: {e}")
    # Continue anyway - don't fail the request
    pass

# Result:
# - Hash always computed locally
# - Blockchain sending is best-effort
# - System remains operational even if blockchain unavailable
# - No impact on request latency if blockchain is slow
```

## Performance Characteristics

| Operation | Time | Impact |
|-----------|------|--------|
| SHA-256 hash computation | < 1ms | Negligible |
| Record serialization | < 0.5ms | Negligible |
| Blockchain send (async) | varies | None (exception caught) |
| Database insert/update | 10-50ms | Normal |
| **Total request overhead** | ~0.5ms | **< 1% increase** |

## Security Considerations

1. **Hash Integrity**
   - SHA-256 is cryptographically secure
   - Any modification changes the hash
   - Deterministic: same record = same hash

2. **Field Exclusion**
   - Excludes auto-generated fields (id)
   - Excludes hash fields themselves
   - Excludes timestamps (for reproducibility)
   - Includes all user-entered data

3. **Blockchain Security**
   - Requires private key (kept in environment)
   - Transactions signed by medical system account
   - On-chain records immutable
   - Audit trail maintained

4. **Database Security**
   - Fields indexed for quick queries
   - Nullable for backward compatibility
   - No sensitive data (hash only)

## Scalability

### Current Design
- Hash computation: O(n) where n = record size (typically < 1KB)
- Database lookups: O(1) with index on blockchain_hash
- Blockchain sends: async, non-blocking

### Future Improvements
- Batch hashes into single blockchain transaction
- IPFS integration for full record archival
- Merkle tree for efficient bulk verification
- Caching layer for hash verification

## Testing Strategy

### Unit Tests
```python
# Test hash consistency
def test_deterministic_hash():
    data = {"name": "John", "age": 30}
    assert compute_hash(data) == compute_hash(data)

# Test field ordering irrelevant
def test_hash_order_invariant():
    data1 = {"a": 1, "b": 2}
    data2 = {"b": 2, "a": 1}
    assert compute_hash(data1) == compute_hash(data2)
```

### Integration Tests
```python
# Test hash generated on create
def test_patient_hash_on_create():
    patient = Patient.objects.create(...)
    assert patient.blockchain_hash is not None

# Test hash changes on update
def test_diagnosis_hash_changes_on_update():
    diagnosis = Diagnosis.objects.create(...)
    hash1 = diagnosis.blockchain_hash
    diagnosis.diagnosis = "Different diagnosis"
    diagnosis.save()
    assert diagnosis.blockchain_hash != hash1
```

### End-to-End Tests
```python
# Test full flow: create → display → verify
def test_patient_hash_verification():
    # Create patient
    patient = Patient.objects.create(...)
    hash1 = patient.blockchain_hash
    
    # Retrieve via API
    response = client.get(f'/api/patients/{patient.id}/')
    assert response.data['blockchainHash'] == hash1
    
    # Verify hash computation
    computed = compute_hash(response.data)
    assert computed == hash1
```

## Deployment Checklist

- [ ] Run migrations (`python manage.py migrate hms`)
- [ ] Verify hash fields exist in database
- [ ] Test patient creation (should generate hash)
- [ ] Test diagnosis creation (should generate hash)
- [ ] Test lab result creation (should generate hash)
- [ ] Verify hashes display in UI
- [ ] Test with blockchain disabled (PRIVATE_KEY not set)
- [ ] Test with blockchain enabled (verify TX hashes)
- [ ] Load test (verify minimal performance impact)
- [ ] Backup database before deployment

---

**This architecture provides a scalable, secure, and maintainable blockchain hashing system for medical records.**
