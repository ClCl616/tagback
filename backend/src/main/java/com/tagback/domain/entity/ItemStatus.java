package com.tagback.domain.entity;

public enum ItemStatus {
    TAG_PENDING, // 태그 연결 대기
    AVAILABLE,  // 대여 가능
    RENTED, // 대여 중
    INSPECTION, // 점검 중
    REPAIR  // 수리 중
}
