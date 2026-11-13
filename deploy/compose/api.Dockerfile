# syntax=docker/dockerfile:1
FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /src
COPY backend/gradle/ ./gradle/
COPY backend/gradlew backend/build.gradle backend/settings.gradle ./
COPY backend/src/ ./src/
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew \
    && sed -i -e 's/networkTimeout=10000/networkTimeout=120000/' \
              -e 's/retries=0/retries=3/' gradle/wrapper/gradle-wrapper.properties
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon bootJar
RUN cp build/libs/*-SNAPSHOT.jar /app.jar

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 tagback \
    && useradd --uid 10001 --gid tagback --no-create-home tagback
WORKDIR /app
COPY --from=build --chown=10001:10001 /app.jar ./app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
