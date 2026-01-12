# Fix: Duplicate Hash Generation Issue

## Problem
When adding a patient, 3 different hashes were being created in the OnChainAudit table.

## Root Cause
There were two conflicting hash generation mechanisms:

1. **Old post_save signals** (in models.py):
   - `audit_patient_on_save()` 
   - `audit_diagnosis_on_save()`
   - These automatically created hashes on every save

2. **New viewset-based hashing** (in views.py):
   - `PatientViewSet.perform_create()`
   - `PatientViewSet.perform_update()`
   - These also created hashes

When you created a patient:
1. First hash: Created by `perform_create()` in viewset
2. Second hash: Created by post_save signal when first hash was saved
3. Third hash: Created by signal again due to the update call in `store_record_hash()`

## Solution
Disabled the old post_save signal receivers in `models.py`:

```python
# OLD CODE (DISABLED):
@receiver(post_save, sender=Patient)
def audit_patient_on_save(sender, instance, created, **kwargs):
    _create_audit_for_instance(instance)

# Now the code is commented out since ViewSets handle hash generation
```

## Result
Now only ONE hash is generated per record creation/update (via the viewset).

## Files Modified
- `server/hms/models.py` - Commented out post_save signal receivers

## Testing
1. Create a new patient
2. Check OnChainAudit table - should have only 1 entry
3. Update the patient
4. OnChainAudit should have 2 entries total (one for create, one for update)

## Note
The old `_create_audit_for_instance()` and `_get_blockchain_client()` functions are kept for reference/rollback purposes. They can be removed in future cleanup if desired.
