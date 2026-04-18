import { z } from "zod";

export const AssetIdSchema = z.string().min(1);
export const ComponentIdSchema = z.string().min(1);
export const SectionIdSchema = z.string().min(1);

export const PageMetadataSchema = z.object({
  title: z.string().min(1).default("Untitled Page"),
  description: z.string().default(""),
  lang: z.string().default("en"),
});

export const ImageAssetSchema = z.object({
  id: AssetIdSchema,
  type: z.literal("image"),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  alt: z.string().default(""),
});

export const AssetSchema = z.discriminatedUnion("type", [ImageAssetSchema]);

export const HeroComponentSchema = z.object({
  id: ComponentIdSchema,
  type: z.literal("hero"),
  headline: z.string().default("A great headline"),
  subheadline: z.string().default("A short, meaningful subheadline."),
  primaryCtaText: z.string().default("Get started"),
  primaryCtaHref: z.string().default("#contact"),
  backgroundImageAssetId: AssetIdSchema.nullable().default(null),
});

export const RichTextComponentSchema = z.object({
  id: ComponentIdSchema,
  type: z.literal("rich_text"),
  html: z.string().default("<p>Your text here.</p>"),
});

export const ImageComponentSchema = z.object({
  id: ComponentIdSchema,
  type: z.literal("image"),
  assetId: AssetIdSchema,
  caption: z.string().default(""),
  style: z
    .object({
      fit: z.union([z.literal("cover"), z.literal("contain")]).nullable().default(null),
      maxWidth: z.union([z.literal(480), z.literal(720), z.literal(980)]).nullable().default(null),
      align: z.union([z.literal("left"), z.literal("center"), z.literal("right")]).nullable().default(null),
      radius: z.number().int().min(0).max(32).nullable().default(null),
    })
    .default({}),
});

export const ContactFormComponentSchema = z.object({
  id: ComponentIdSchema,
  type: z.literal("contact_form"),
  headline: z.string().default("Contact us"),
  submitLabel: z.string().default("Send"),
});

export const ComponentSchema = z.discriminatedUnion("type", [
  HeroComponentSchema,
  RichTextComponentSchema,
  ImageComponentSchema,
  ContactFormComponentSchema,
]);

export const SECTION_MAX_WIDTHS = [720, 980, 1200] as const;
const SectionMaxWidthSchema = z.union([z.literal(720), z.literal(980), z.literal(1200)]).nullable().default(null);

export const SectionSchema = z.object({
  id: SectionIdSchema,
  label: z.string().default("Section"),
  style: z
    .object({
      background: z
        .string()
        .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
        .nullable()
        .default(null),
      padding: z.number().int().min(0).max(96).nullable().default(null),
      maxWidth: SectionMaxWidthSchema,
    })
    .default({}),
  components: z.array(ComponentSchema).default([]),
});

export const PageSchema = z.object({
  version: z.literal(1),
  metadata: PageMetadataSchema.default({}),
  sections: z.array(SectionSchema).default([]),
  assets: z.array(AssetSchema).default([]),
});

export type Page = z.infer<typeof PageSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Section = z.infer<typeof SectionSchema>;
