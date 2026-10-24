# FarmOS API — FrankenPHP (Caddy + PHP in one process, HTTP/2 & HTTP/3, worker-friendly).
FROM dunglas/frankenphp:1-php8.4 AS base

RUN install-php-extensions pdo_pgsql redis pcntl bcmath intl opcache zip

ENV SERVER_NAME=:8000 \
    APP_ENV=production \
    APP_DEBUG=false \
    LOG_CHANNEL=stderr

WORKDIR /app

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

COPY . .
RUN composer dump-autoload --optimize --classmap-authoritative \
    && php artisan storage:link || true \
    && chown -R www-data:www-data storage bootstrap/cache

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-farmos.ini

EXPOSE 8000
# Config/route/event caches are built at start so they see the runtime environment.
CMD ["sh", "-c", "php artisan config:cache && php artisan route:cache && php artisan event:cache && frankenphp php-server --root public --listen :8000"]
