package com.tagback.controller;

import com.tagback.dto.tag.TagLookupResponse;
import com.tagback.service.TagLifecycleService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tags")
public class TagLookupController {
    private final TagLifecycleService lifecycle;

    public TagLookupController(TagLifecycleService lifecycle) {
        this.lifecycle = lifecycle;
    }

    @GetMapping("/{uid}")
    public TagLookupResponse lookup(@PathVariable String uid) {
        return lifecycle.lookup(uid);
    }
}
