package com.tagback.config;

import java.lang.annotation.*;

/** Requires RentalAuthenticationInterceptor; a mobile session cannot substitute for a rental grant. */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RentalAuthenticated {}
