package com.tagback.service;

import com.tagback.config.AdminPrincipal;
import com.tagback.dto.rental.NfcScanProof;
import com.tagback.exception.*;
import com.tagback.domain.repository.ItemRepository;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class KioskTagService {
    private final JdbcTemplate jdbc;
    private final NfcScanProofVerifier proofs;
    private final TagLifecycleService tags;
    private final ItemRepository items;
    private final ItemService details;
    private final AdminAudit audit;
    private final ObjectMapper json;
    private final java.time.Clock clock;
    public KioskTagService(JdbcTemplate jdbc, NfcScanProofVerifier proofs, TagLifecycleService tags,
            ItemRepository items, ItemService details, AdminAudit audit, ObjectMapper json, java.time.Clock clock) {
        this.jdbc=jdbc; this.proofs=proofs; this.tags=tags; this.items=items; this.details=details; this.audit=audit; this.json=json; this.clock=clock;
    }
    public record Result(String itemId, String uid, String status) {}
    @Transactional
    public Result connect(AdminPrincipal admin, UUID operationId, long itemId, String expectedUid, NfcScanProof proof) {
        if (!"KIOSK".equals(admin.channel())) throw new AuthException(AuthErrorCode.FORBIDDEN);
        // Serialize registration/replay, including two different administrator sessions.
        jdbc.execute("select pg_advisory_xact_lock(20261119, 1)");
        proofs.verifyForReplay(proof);
        String fingerprint = AdminPassword.digest(json.writeValueAsString(new Object[]{itemId,expectedUid,proof}));
        var previous = jdbc.query("select fingerprint,response_json from admin_tag_operations where operation_id=?",
                (rs,n) -> new String[]{rs.getString(1),rs.getString(2)},operationId);
        if (!previous.isEmpty()) {
            if (!previous.getFirst()[0].equals(fingerprint)) throw new AuthException(AuthErrorCode.IDEMPOTENCY_KEY_CONFLICT);
            return json.readValue(previous.getFirst()[1],Result.class);
        }
        if (clock.millis() - proof.issuedAt() > 60_000) {
            // A durable no-op lets an UNKNOWN client recover even after its scan expires.
            var cancelled = new Result(Long.toString(itemId),proof.uid(),"NOT_APPLIED");
            jdbc.update("insert into admin_tag_operations(operation_id,fingerprint,response_json) values (?,?,?)",
                    operationId,fingerprint,json.writeValueAsString(cancelled));
            return cancelled;
        }
        var verified = proofs.verify(proof);
        var item = items.findForUpdate(itemId).orElseThrow(ItemException::itemNotFound);
        if (item.getStatus() == com.tagback.domain.entity.ItemStatus.RENTED || items.hasActiveRental(itemId)) throw new com.tagback.exception.TagRegistrationException(
                org.springframework.http.HttpStatus.CONFLICT,"ITEM_RENTED","대여 중에는 태그를 변경할 수 없습니다.");
        if (jdbc.update("insert into nfc_scan_proof_uses(nonce,tag_uid) values (?,?) on conflict do nothing",
                verified.nonce(),verified.uid()) != 1) throw RentalException.scanProofUsed();
        tags.replace(itemId,verified.uid(),expectedUid,null);
        var result = new Result(Long.toString(itemId),verified.uid(),details.detail(itemId).status().toString());
        audit.record(admin,expectedUid==null ? "TAG_REGISTER" : "TAG_REPLACE",itemId,verified.bridgeId(),expectedUid,verified.uid());
        jdbc.update("insert into admin_tag_operations(operation_id,fingerprint,response_json) values (?,?,?)",
                operationId,fingerprint,json.writeValueAsString(result));
        return result;
    }
}
