# Plasmic Commerce Components Documentation

This document provides comprehensive documentation for all commerce components available in the Plasmic Commerce package. These components enable you to build complete e-commerce experiences with any supported commerce backend.

## Table of Contents

1. [Product Components](#product-components)
   - [ProductCollection](#productcollection)
   - [ProductBox](#productbox)
   - [ProductTextField](#producttextfield)
   - [ProductPrice](#productprice)
   - [ProductMedia](#productmedia)
   - [ProductMediaCollection](#productmediacollection)
   - [ProductQuantity](#productquantity)
   - [ProductVariantPicker](#productvariantpicker)
   - [ProductSlider](#productslider)
   - [ProductLink](#productlink)
2. [Category Components](#category-components)
   - [CategoryCollection](#categorycollection)
   - [CategoryField](#categoryfield)
   - [CategoryLink](#categorylink)
   - [CategoryMedia](#categorymedia)
3. [Cart Components](#cart-components)
   - [Cart](#cart)
   - [CartProvider](#cartprovider)
   - [AddToCartButton](#addtocartbutton)

---

## Product Components

### ProductCollection

**Display Name:** Product Collection

**Description:** Shows a collection of products from a specific category. Ideal for creating product listing pages, category pages, and search results.

**Key Features:**
- Displays multiple products in a grid layout
- Supports filtering by category, brand, and search terms
- Includes subcategory products option
- Built-in sorting options (trending, new arrivals, price)
- Customizable empty and loading states
- Auto-repeats child components for each product

**Props:**
- `children` - The template for each product item (slot)
- `emptyMessage` - Message shown when no products found (slot)
- `loadingMessage` - Message shown while loading (slot)
- `count` - Maximum number of products to display (number)
- `category` - Category ID to filter products (choice)
- `includeSubCategories` - Include products from subcategories (boolean)
- `brand` - Brand ID to filter products (choice)
- `search` - Search term to filter products (string)
- `sort` - Sort order: trending-desc, latest-desc, price-asc, price-desc (choice)
- `noLayout` - Skip container element rendering (boolean)
- `noAutoRepeat` - Disable automatic repetition of children (boolean)

**When to use:** Use ProductCollection when you need to display multiple products, such as on category pages, search results, or featured product sections.

---

### ProductBox

**Display Name:** Product Box

**Description:** Shows a single product by ID. Perfect for displaying specific products or creating product detail pages.

**Key Features:**
- Displays one specific product
- Product picker with search functionality
- Provides product context to child components
- Loading state handling
- Error handling for missing products

**Props:**
- `children` - Content to display for the product (slot)
- `id` - Product ID (cardPicker with search)
- `noLayout` - Skip container element rendering (boolean)

**When to use:** Use ProductBox when you need to display a specific product, such as on a product detail page or when featuring individual products.

---

### ProductTextField

**Display Name:** Product Text Field

**Description:** Displays text information from the current product context.

**Key Features:**
- Access to multiple product fields
- HTML rendering support for descriptions
- Automatic placeholder in design mode

**Props:**
- `field` - The product field to display (choice):
  - `id` - Product ID
  - `name` - Product name
  - `description` - Product description (renders HTML)
  - `sku` - Stock keeping unit
  - `slug` - URL-friendly product identifier
  - `path` - Product path

**When to use:** Use ProductTextField inside ProductCollection or ProductBox to display product text information like names, descriptions, or SKUs.

---

### ProductPrice

**Display Name:** Product Price

**Description:** Displays the formatted price of a product, with support for variant pricing.

**Key Features:**
- Automatic currency formatting
- Variant-aware pricing
- Integration with ProductVariantPicker
- Form context integration

**Props:** None (uses product context)

**When to use:** Use ProductPrice inside a product context to display the current price, which updates automatically when variants are selected.

---

### ProductMedia

**Display Name:** Product Media

**Description:** Displays a product image with lazy loading support.

**Key Features:**
- Lazy loading for performance
- Media index selection
- Integration with ProductMediaCollection
- Placeholder image in design mode
- Alt text for accessibility

**Props:**
- `mediaIndex` - Index of the image to display (number, hidden in media context)

**When to use:** Use ProductMedia to display product images, either standalone or within ProductMediaCollection/ProductSlider.

---

### ProductMediaCollection

**Display Name:** Product Media Collection

**Description:** Displays all product images in a grid layout.

**Key Features:**
- Automatic grid layout
- Repeats media component for each image
- Provides media context to children
- Customizable grid styling

**Props:**
- `media` - Template for each media item (slot, restricted to ProductMedia)

**When to use:** Use ProductMediaCollection to create image galleries showing all product images at once.

---

### ProductQuantity

**Display Name:** Product Quantity

**Description:** Input component for selecting product quantity before adding to cart.

**Key Features:**
- Form integration
- Default value of 1
- Customizable input element
- Controller pattern for form state

**Props:**
- `children` - The input element to use (slot, defaults to number input)

**When to use:** Use ProductQuantity on product pages where customers need to specify how many items to add to cart.

---

### ProductVariantPicker

**Display Name:** Product Variant Picker

**Description:** Dropdown selector for choosing product variants (size, color, etc.).

**Key Features:**
- Automatic variant listing
- Form integration
- Price update coordination
- Default variant selection

**Props:** None (uses product context)

**When to use:** Use ProductVariantPicker on product detail pages when products have multiple variants to choose from.

---

### ProductSlider

**Display Name:** Product Slider

**Description:** Creates an image slider with main image and thumbnails.

**Key Features:**
- Main image display with thumbnails
- Configurable number of visible thumbnails
- Click navigation between images
- Responsive thumbnail grid
- Slide selection state

**Props:**
- `slideContainer` - Template for the main slide (slot)
- `thumbsContainer` - Template for thumbnail items (slot)
- `thumbsVisible` - Number of thumbnails to show (number, default: 4)
- `slideSelected` - Currently selected slide index (number)

**When to use:** Use ProductSlider for product detail pages where you want an interactive image gallery with thumbnail navigation.

---

### ProductLink

**Display Name:** Product Link

**Description:** Creates a link to a product page with dynamic URL generation.

**Key Features:**
- Dynamic URL generation using product fields
- Template string support with {field} syntax
- Preserves styling of child elements
- Automatic field resolution

**Props:**
- `children` - Content to wrap in link (slot)
- `linkDest` - URL template, e.g., "products/{slug}" (string)

**When to use:** Use ProductLink to create navigation to product detail pages from product listings or related product sections.

---

## Category Components

### CategoryCollection

**Display Name:** Category Collection

**Description:** Displays a collection of categories with their products.

**Key Features:**
- Hierarchical category display
- Automatic product collection per category
- Empty category handling
- Subcategory support
- Loading and empty states

**Props:**
- `children` - Template for each category (slot)
- `emptyMessage` - Message when no categories found (slot)
- `loadingMessage` - Loading state message (slot)
- `category` - Parent category to filter by (choice)
- `noLayout` - Skip container element (boolean)
- `noAutoRepeat` - Disable auto-repetition (boolean)

**When to use:** Use CategoryCollection to create category listing pages or navigation menus showing multiple categories.

---

### CategoryField

**Display Name:** Category Field

**Description:** Displays text information from the current category context.

**Key Features:**
- Access to category properties
- Placeholder text in design mode
- Simple text output

**Props:**
- `field` - The category field to display (choice):
  - `id` - Category ID
  - `name` - Category name
  - `slug` - URL-friendly identifier
  - `path` - Category path

**When to use:** Use CategoryField inside CategoryCollection to display category information like names or slugs.

---

### CategoryLink

**Display Name:** Category Link

**Description:** Creates a link to a category page with dynamic URL generation.

**Key Features:**
- Dynamic URL generation using category fields
- Template string support with {field} syntax
- Preserves child styling
- Field resolution

**Props:**
- `children` - Content to wrap in link (slot)
- `linkDest` - URL template, e.g., "category/{slug}" (string)

**When to use:** Use CategoryLink to create navigation links to category pages from category listings or navigation menus.

---

### CategoryMedia

**Display Name:** Category Media

**Description:** Displays category images with lazy loading.

**Key Features:**
- Lazy loading support
- Media index selection
- Alt text for accessibility
- Handles missing images

**Props:**
- `mediaIndex` - Index of the image to display (number)

**When to use:** Use CategoryMedia to display category images in category listings or headers.

---

## Cart Components

### Cart

**Display Name:** Cart

**Description:** Displays cart information like item count or total price.

**Key Features:**
- Shows cart size (item count) or total price
- Currency formatting for prices
- Optional hiding when empty
- Real-time updates

**Props:**
- `field` - Information to display (choice):
  - `Size` - Number of items in cart
  - `Total Price` - Formatted cart total
- `hideIfIsEmpty` - Hide component when cart is empty (boolean)

**When to use:** Use Cart in headers or cart summaries to show cart status without full cart details.

---

### CartProvider

**Display Name:** Cart Provider

**Description:** Provides cart data context for creating custom cart interfaces.

**Key Features:**
- Exposes full cart data via context
- Enables custom cart UI creation
- Access via dynamic values
- Real-time cart updates

**Props:**
- `children` - Custom cart UI (slot)

**When to use:** Use CartProvider when building custom cart interfaces that need access to detailed cart data like line items, quantities, or pricing.

---

### AddToCartButton

**Display Name:** Add To Cart Button

**Description:** Button component that adds the current product to the cart.

**Key Features:**
- Integrates with ProductQuantity and ProductVariantPicker
- Form validation
- Error handling
- Preserves custom click handlers
- Automatic variant selection

**Props:**
- `children` - Button element to enhance (slot, defaults to button)

**When to use:** Use AddToCartButton on product pages to allow customers to add items to their cart with selected quantity and variants.

---

## Component Relationships

### Product Context Flow
```
ProductCollection/ProductBox
  └── ProductTextField
  └── ProductPrice
  └── ProductMedia/ProductMediaCollection/ProductSlider
  └── ProductLink
  └── ProductQuantity
  └── ProductVariantPicker
  └── AddToCartButton
```

### Category Context Flow
```
CategoryCollection
  └── CategoryField
  └── CategoryLink
  └── CategoryMedia
  └── ProductCollection (nested)
```

### Form Context
Several components work together through React Hook Form:
- `ProductVariantPicker` - Sets selected variant
- `ProductQuantity` - Sets quantity
- `ProductPrice` - Reads variant to show correct price
- `AddToCartButton` - Reads both variant and quantity

---

## Best Practices

1. **Context Requirements:** Many components require a parent context provider (ProductCollection/ProductBox for product components, CategoryCollection for category components).

2. **Performance:** Use lazy loading features and limit collection sizes with the `count` prop for better performance.

3. **Styling:** Components accept className props and have default styles that can be overridden in Plasmic Studio.

4. **Error Handling:** Components include built-in error states and loading indicators. Customize these with the appropriate message slots.

5. **SEO:** Use semantic HTML and proper alt texts for images. The components are designed to be SEO-friendly.

6. **Accessibility:** Components include proper ARIA attributes and keyboard navigation where applicable.