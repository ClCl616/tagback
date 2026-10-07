package com.tagback;

import com.tagback.controller.MockSmsController;
import com.tagback.controller.SmsAuthController;
import com.tagback.service.sms.MockSmsDelivery;
import com.tagback.service.sms.SmsAuthService;
import com.tagback.service.sms.SmsSecrets;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import static org.junit.jupiter.api.Assertions.*;

class SmsMockProfileTest {
    @Test void mockBeansAreAbsentWithoutOptInAndWhenProductionIsActive() {
        for (String[] profiles : new String[][]{{}, {"sms-mock", "prod"}, {"sms-mock", "production"}}) {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.getEnvironment().setActiveProfiles(profiles);
                context.register(SmsSecrets.class, MockSmsDelivery.class, SmsAuthService.class,
                        SmsAuthController.class, MockSmsController.class);
                context.refresh();
                assertTrue(context.getBeansOfType(SmsAuthController.class).isEmpty());
                assertTrue(context.getBeansOfType(MockSmsController.class).isEmpty());
                assertTrue(context.getBeansOfType(SmsSecrets.class).isEmpty());
            }
        }
    }
}
