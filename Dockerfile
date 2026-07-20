FROM php:8.2-apache

# Install PDO MySQL extension
RUN docker-php-ext-install pdo pdo_mysql

# Enable Apache mod_rewrite
RUN a2enmod rewrite

# Allow .htaccess overrides in /var/www/html
RUN sed -i 's/AllowOverride None/AllowOverride All/g' /etc/apache2/apache2.conf

# Set DirectoryIndex to login.html index.html index.php
RUN echo "DirectoryIndex login.html index.html index.php" >> /etc/apache2/apache2.conf

# Copy project files into container
COPY . /var/www/html/

# Copy public files into web root
RUN cp -rn /var/www/html/public/* /var/www/html/

# Set permissions
RUN chown -R www-data:www-data /var/www/html
