package com.tagback;
import com.tagback.controller.TagRegistrationController;
import com.tagback.exception.ApiExceptionHandler;
import com.tagback.service.TagRegistrationService;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
class TagRegistrationControllerTest {
    @Test void uidOnlyWritesAreRetiredEvenWithoutAuthenticationInterceptor() throws Exception {
        var service=mock(TagRegistrationService.class);
        var mvc=standaloneSetup(new TagRegistrationController(service)).setControllerAdvice(new ApiExceptionHandler()).build();
        for (var request : new org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder[]{
                post("/api/items/12/tag"),put("/api/items/12/tag"),delete("/api/items/12/tag")}) {
            mvc.perform(request).andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        }
        verifyNoInteractions(service);
    }
}
