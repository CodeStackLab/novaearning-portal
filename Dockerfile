# Use Node.js base image
FROM node:18-alpine

# Set working directory inside container
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy all files
COPY . .

# Expose server port
EXPOSE 80

# Start server in production by default
CMD ["npm", "start"]
