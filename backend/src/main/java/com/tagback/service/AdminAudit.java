package com.tagback.service;

import com.tagback.config.AdminPrincipal;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class AdminAudit {
    private final JdbcTemplate jdbc;
    public AdminAudit(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public void record(AdminPrincipal admin, String action, long itemId, String bridgeId, String oldUid, String newUid) {
        jdbc.update("insert into admin_audit(session_id,action,item_id,bridge_id,previous_uid,new_uid) values (?,?,?,?,?,?)",
                admin.sessionId(), action, itemId, bridgeId, oldUid, newUid);
    }
}
