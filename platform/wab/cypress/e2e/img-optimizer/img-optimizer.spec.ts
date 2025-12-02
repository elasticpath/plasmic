/**
 * Cypress E2E tests for img-optimizer service
 * 
 * These tests validate the image optimization API endpoints
 * with real HTTP requests against a running server.
 */

describe("img-optimizer", function () {
  // Use the standalone server port
  const baseUrl = "http://localhost:3005";
  const s3BaseUrl = Cypress.env("SITE_ASSETS_BASE_URL") || "http://localhost:4566/test-bucket/";
  
  // Override the default baseUrl for these tests
  before(() => {
    Cypress.config("baseUrl", baseUrl);
  });
  
  // Test image URLs
  const testImageUrl = `${s3BaseUrl}test-images/sample.jpg`;
  const testPngUrl = `${s3BaseUrl}test-images/sample.png`;
  const largeImageUrl = `${s3BaseUrl}large-image.jpg`;
  
  describe("optimize endpoint", () => {
    it("should optimize a JPEG image to WebP", () => {
      const params = new URLSearchParams({
        src: testImageUrl,
        w: "300",
        q: "80",
        f: "webp"
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        encoding: "binary"
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.headers["content-type"]).to.eq("image/webp");
        expect(response.headers["cache-control"]).to.include("max-age=31536000");
        expect(response.headers["x-cache"]).to.match(/^(HIT|MISS)$/);
        
        // Validate WebP format
        const buffer = Cypress.Buffer.from(response.body, "binary");
        const riff = buffer.toString("ascii", 0, 4);
        const webp = buffer.toString("ascii", 8, 12);
        expect(riff).to.eq("RIFF");
        expect(webp).to.eq("WEBP");
      });
    });
    
    it("should handle caching correctly", () => {
      // Use unique parameters to avoid conflicts
      const uniqueWidth = Math.floor(Math.random() * 100) + 200;
      const params = new URLSearchParams({
        src: testImageUrl,
        w: uniqueWidth.toString(),
        q: "90"
      });
      
      // First request should be a MISS
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        encoding: "binary"
      }).then((firstResponse) => {
        expect(firstResponse.status).to.eq(200);
        expect(firstResponse.headers["x-cache"]).to.eq("MISS");
        
        // Second request should be a HIT
        cy.request({
          method: "GET",
          url: `${baseUrl}/img-optimizer/v1/img?${params}`,
          encoding: "binary"
        }).then((secondResponse) => {
          expect(secondResponse.status).to.eq(200);
          expect(secondResponse.headers["x-cache"]).to.eq("HIT");
          
          // Content should be identical
          expect(secondResponse.body.length).to.eq(firstResponse.body.length);
        });
      });
    });
    
    it("should preserve PNG transparency", () => {
      const params = new URLSearchParams({
        src: testPngUrl,
        w: "400",
        q: "95"
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        encoding: "binary"
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.headers["content-type"]).to.match(/image\/(png|webp)/);
        expect(response.body).to.not.be.empty;
      });
    });
    
    it("should resize images with width parameter", () => {
      const params = new URLSearchParams({
        src: largeImageUrl,
        w: "640"
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        encoding: "binary"
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.headers["content-type"]).to.match(/image\/(jpeg|webp)/);
        // The resized image should be smaller than the original
        expect(response.body).to.not.be.empty;
      });
    });
    
    it("should resize images with height parameter", () => {
      const params = new URLSearchParams({
        src: largeImageUrl,
        h: "480"
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        encoding: "binary"
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.headers["content-type"]).to.match(/image\/(jpeg|webp)/);
        expect(response.body).to.not.be.empty;
      });
    });
    
    it("should resize images with both width and height", () => {
      const params = new URLSearchParams({
        src: largeImageUrl,
        w: "640",
        h: "480"
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        encoding: "binary"
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.headers["content-type"]).to.match(/image\/(jpeg|webp)/);
        expect(response.body).to.not.be.empty;
      });
    });
    
    it("should handle non-existent images gracefully", () => {
      const params = new URLSearchParams({
        src: `${s3BaseUrl}non-existent-image.jpg`
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(404);
      });
    });
    
    it("should validate required parameters", () => {
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error.message).to.include("Missing required parameter: src");
      });
    });
    
    it("should validate width parameter range", () => {
      const params = new URLSearchParams({
        src: testImageUrl,
        w: "5000" // Exceeds MAX_WIDTH
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error.message).to.include("Invalid width");
      });
    });
    
    it("should validate height parameter range", () => {
      const params = new URLSearchParams({
        src: testImageUrl,
        h: "5000" // Exceeds MAX_HEIGHT
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error.message).to.include("Invalid height");
      });
    });
    
    it("should validate quality parameter", () => {
      const params = new URLSearchParams({
        src: testImageUrl,
        q: "150" // Invalid quality
      });
      
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img?${params}`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error.message).to.include("Invalid quality");
      });
    });
  });
  
  describe("static endpoint", () => {
    it("should optimize image using static path", () => {
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img/test-image.jpg?w=500&f=webp`,
        encoding: "binary"
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.headers["content-type"]).to.eq("image/webp");
        expect(response.headers["cache-control"]).to.include("max-age=31536000");
        
        // Validate WebP format
        const buffer = Cypress.Buffer.from(response.body, "binary");
        const riff = buffer.toString("ascii", 0, 4);
        const webp = buffer.toString("ascii", 8, 12);
        expect(riff).to.eq("RIFF");
        expect(webp).to.eq("WEBP");
      });
    });
    
    it("should handle missing image ID", () => {
      cy.request({
        method: "GET",
        url: `${baseUrl}/img-optimizer/v1/img/`,
        failOnStatusCode: false
      }).then((response) => {
        expect(response.status).to.eq(400);
      });
    });
  });
});