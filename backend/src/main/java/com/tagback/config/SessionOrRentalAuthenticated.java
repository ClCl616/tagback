package com.tagback.config;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Accepts a login session, or a verified rental grant when Authorization is supplied. */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface SessionOrRentalAuthenticated {}
