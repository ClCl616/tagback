package com.tagback.controller;

import com.tagback.config.*;
import com.tagback.exception.*;
import com.tagback.service.SearchQuery;
import jakarta.servlet.http.HttpServletRequest;
import java.io.*;
import java.util.*;
import javax.imageio.ImageIO;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
public class ItemMediaController {
    private final JdbcTemplate jdbc;
    private final AuthOriginGuard origins;
    public ItemMediaController(JdbcTemplate jdbc, AuthOriginGuard origins) { this.jdbc=jdbc; this.origins=origins; }

    @GetMapping("/catalog/items") @PublicApi
    public Object items(@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="20") int size,
            @RequestParam(defaultValue="") String keyword,@RequestParam(required=false) Long itemTypeId,
            @RequestParam(defaultValue="false") boolean availableOnly) {
        SearchQuery.page(page,size);
        String search=SearchQuery.pattern(Optional.ofNullable(SearchQuery.keyword(keyword)).orElse("").toLowerCase(Locale.ROOT));
        String from=" from items i join item_types t on t.item_type_id=i.item_type_id where i.status<>'TAG_PENDING' "
            +"and (lower(i.item_name) like ? escape '!' or lower(t.name) like ? escape '!')"
            +(itemTypeId==null?"":" and i.item_type_id=?")+(availableOnly?" and i.status='AVAILABLE'":"");
        var args=new ArrayList<Object>(List.of(search,search)); if(itemTypeId!=null)args.add(itemTypeId);
        long total=jdbc.queryForObject("select count(*)"+from,Long.class,args.toArray());
        args.add(size);args.add((long)page*size);
        var rows=jdbc.queryForList("select i.item_id::text as \"itemId\",i.item_name as \"itemName\",i.item_type_id::text as \"itemTypeId\",t.name as \"itemTypeName\",i.status,"
            +"'/api/v1/catalog/images/'||i.image_id as \"imageUrl\",'/api/v1/catalog/images/'||t.image_id as \"typeImageUrl\""+from+" order by i.item_id limit ? offset ?",args.toArray());
        return Map.of("items",rows,"page",page,"size",size,"totalElements",total,"totalPages",(total+size-1)/size);
    }

    public record Upload(String data) { @Override public String toString(){return "ImageUpload[redacted]";} }
    @PutMapping({"/items/{id}/image","/item-types/{id}/image"}) @AdminOnly @Transactional
    public Object upload(@PathVariable long id,@RequestBody Upload upload,HttpServletRequest request) {
        origins.check(request);
        if(upload.data()==null||upload.data().length()>2_800_000)throw new AuthException(AuthErrorCode.INVALID_INPUT);
        byte[] content;
        try {
            byte[] bytes=Base64.getDecoder().decode(upload.data());
            try(var input=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers=ImageIO.getImageReaders(input);
                if(!readers.hasNext())throw new IOException();
                var reader=readers.next();
                try {
                    reader.setInput(input);
                    String format=reader.getFormatName();
                    if(!format.equalsIgnoreCase("png")&&!format.equalsIgnoreCase("jpeg"))throw new IOException();
                    if(reader.getWidth(0)>2048||reader.getHeight(0)>2048)throw new IOException();
                    var image=reader.read(0);
                    var output=new ByteArrayOutputStream(); ImageIO.write(image,"png",output);content=output.toByteArray();
                    if(content.length>4_000_000)throw new IOException();
                } finally {reader.dispose();}
            }
        } catch(IOException|IllegalArgumentException e) {throw new AuthException(AuthErrorCode.INVALID_INPUT);}
        UUID image=UUID.randomUUID();
        jdbc.update("insert into item_images(image_id,content,media_type) values (?,?,'image/png')",image,content);
        boolean type=request.getRequestURI().startsWith("/api/v1/item-types/");
        if(jdbc.update(type?"update item_types set image_id=? where item_type_id=?":"update items set image_id=? where item_id=?",image,id)!=1)throw new AuthException(AuthErrorCode.INVALID_INPUT);
        cleanup();
        return Map.of("imageUrl","/api/v1/catalog/images/"+image);
    }
    @DeleteMapping({"/items/{id}/image","/item-types/{id}/image"}) @AdminOnly @Transactional
    public ResponseEntity<Void> remove(@PathVariable long id,HttpServletRequest request) {
        origins.check(request);
        boolean type=request.getRequestURI().startsWith("/api/v1/item-types/");
        if(jdbc.update(type?"update item_types set image_id=null where item_type_id=?":"update items set image_id=null where item_id=?",id)!=1)throw new AuthException(AuthErrorCode.INVALID_INPUT);
        cleanup();return ResponseEntity.noContent().build();
    }
    private void cleanup(){jdbc.update("delete from item_images m where not exists(select 1 from items i where i.image_id=m.image_id) and not exists(select 1 from item_types t where t.image_id=m.image_id)");}
    @GetMapping("/catalog/images/{id}") @PublicApi
    public ResponseEntity<byte[]> image(@PathVariable UUID id) {
        var rows=jdbc.query("select content from item_images where image_id=?",(rs,n)->rs.getBytes(1),id);
        if(rows.isEmpty())return ResponseEntity.notFound().build();
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).header("X-Content-Type-Options","nosniff")
            .cacheControl(CacheControl.noCache()).body(rows.getFirst());
    }
}
