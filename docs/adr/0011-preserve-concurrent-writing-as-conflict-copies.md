# Preserve concurrent writing as conflict copies

When independent device changes cannot synchronize cleanly, Specular preserves both versions by creating a conflict copy rather than applying last-writer-wins or attempting an automatic prose merge. This adds a visible resolution step, but choosing or blending words automatically would violate the product's append-only evolution and author-owned writing principles.
