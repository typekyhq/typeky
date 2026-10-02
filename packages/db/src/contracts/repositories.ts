/**
 * Repository contracts.
 *
 * This is the only surface application code may use to reach data: routes must
 * not build SQL, and the port underneath is replaceable (CONTRIBUTING.md section
 * 3, red line 4).
 *
 * Every method takes a `TenantContext` first (architecture section 5.3). Writes
 * are whole documents, not patches -- see the note in `types.ts`.
 */

import type { TenantContext } from './context'
import type {
  ContentStatus,
  ContentType,
  ListMediaQuery,
  ListPostsQuery,
  ListQuery,
  MediaItem,
  MediaUsage,
  MediaWrite,
  Page,
  PageResult,
  PageWrite,
  Post,
  PostWrite,
  Product,
  ProductWrite,
  Site,
  SiteWrite,
  Term,
  TermNode,
  TermWrite,
  ThemeTemplate,
  ThemeTemplateWrite,
  Vocabulary,
  VocabularyWrite,
} from './types'

export interface SiteRepository {
  /** The single CE site row, or null before it has been created. */
  get(ctx: TenantContext): Promise<Site | null>
  /** Creates or replaces that row. */
  save(ctx: TenantContext, input: SiteWrite): Promise<Site>
}

export interface PageRepository {
  list(ctx: TenantContext, query?: ListQuery): Promise<PageResult<Page>>
  byId(ctx: TenantContext, id: string): Promise<Page | null>
  bySlug(ctx: TenantContext, slug: string): Promise<Page | null>
  /** The page flagged as home, of which the database allows at most one. */
  home(ctx: TenantContext): Promise<Page | null>
  /** Creates when `input.id` is absent, otherwise replaces that page. */
  upsert(ctx: TenantContext, input: PageWrite): Promise<Page>
  /** Makes this page the home page, clearing the previous one atomically. */
  setHome(ctx: TenantContext, id: string): Promise<Page>
  /** Publishes or unpublishes many rows in one statement. */
  updateMany(ctx: TenantContext, ids: string[], change: { status: ContentStatus }): Promise<number>
  remove(ctx: TenantContext, id: string): Promise<boolean>
  /** Removes many rows in one statement, answering how many existed. */
  removeMany(ctx: TenantContext, ids: string[]): Promise<number>
}

export interface PostRepository {
  list(ctx: TenantContext, query?: ListPostsQuery): Promise<PageResult<Post>>
  byId(ctx: TenantContext, id: string): Promise<Post | null>
  bySlug(ctx: TenantContext, slug: string): Promise<Post | null>
  upsert(ctx: TenantContext, input: PostWrite): Promise<Post>
  /** Publishes or unpublishes many rows in one statement. */
  updateMany(ctx: TenantContext, ids: string[], change: { status: ContentStatus }): Promise<number>
  remove(ctx: TenantContext, id: string): Promise<boolean>
  /** Removes many rows in one statement, answering how many existed. */
  removeMany(ctx: TenantContext, ids: string[]): Promise<number>
}

export interface ProductRepository {
  list(ctx: TenantContext, query?: ListQuery): Promise<PageResult<Product>>
  byId(ctx: TenantContext, id: string): Promise<Product | null>
  bySlug(ctx: TenantContext, slug: string): Promise<Product | null>
  upsert(ctx: TenantContext, input: ProductWrite): Promise<Product>
  /** Publishes or unpublishes many rows in one statement. */
  updateMany(ctx: TenantContext, ids: string[], change: { status: ContentStatus }): Promise<number>
  remove(ctx: TenantContext, id: string): Promise<boolean>
  /** Removes many rows in one statement, answering how many existed. */
  removeMany(ctx: TenantContext, ids: string[]): Promise<number>
}

export interface MediaRepository {
  list(ctx: TenantContext, query?: ListMediaQuery): Promise<PageResult<MediaItem>>
  byId(ctx: TenantContext, id: string): Promise<MediaItem | null>
  insert(ctx: TenantContext, input: MediaWrite): Promise<MediaItem>
  /**
   * Where this media is used, so a delete can say what it will affect before it
   * happens.
   *
   * Deleting clears the references rather than being refused -- the schema's
   * ON DELETE SET NULL already says so -- which makes the count a warning rather
   * than a gate. It has to be honest about the JSON columns too: a body is Block
   * JSON and an image block holds a media id, so a check that only looked at
   * `cover_media_id` would quietly miss most of the places an image is used.
   */
  usages(ctx: TenantContext, id: string): Promise<MediaUsage>
  /** Deleting media clears references to it rather than blocking the delete. */
  remove(ctx: TenantContext, id: string): Promise<boolean>
}

export interface ThemeTemplateRepository {
  /** Overrides for a theme, ordered by path. */
  list(ctx: TenantContext, theme: string): Promise<ThemeTemplate[]>
  byPath(ctx: TenantContext, theme: string, path: string): Promise<ThemeTemplate | null>
  /** Creates or replaces the override for this path, bumping its revision. */
  save(ctx: TenantContext, input: ThemeTemplateWrite): Promise<ThemeTemplate>
  /** Drops the override, which restores the bundled baseline template. */
  reset(ctx: TenantContext, theme: string, path: string): Promise<boolean>
}

export interface VocabularyRepository {
  list(ctx: TenantContext): Promise<Vocabulary[]>
  byId(ctx: TenantContext, id: string): Promise<Vocabulary | null>
  /** The vocabularies a content type may draw from, in sort order. */
  forContentType(ctx: TenantContext, contentType: ContentType): Promise<Vocabulary[]>
  /** Creates when `input.id` is absent, otherwise replaces that vocabulary. */
  upsert(ctx: TenantContext, input: VocabularyWrite): Promise<Vocabulary>
  /** Removes the vocabulary and, by cascade, every term in it. */
  remove(ctx: TenantContext, id: string): Promise<boolean>
}

export interface TermRepository {
  /** Every term of a vocabulary, flat and in the order the tree renders them. */
  list(ctx: TenantContext, vocabularyId: string): Promise<Term[]>
  /** The same terms assembled into a tree, which is what the admin edits. */
  tree(ctx: TenantContext, vocabularyId: string): Promise<TermNode[]>
  byId(ctx: TenantContext, id: string): Promise<Term | null>
  /** The ancestry of a term, root first and the term itself last. */
  path(ctx: TenantContext, id: string): Promise<Term[]>
  /** Creates when `input.id` is absent, otherwise replaces that term. */
  upsert(ctx: TenantContext, input: TermWrite): Promise<Term>
  /** Removes the term, its descendants and its assignments. */
  remove(ctx: TenantContext, id: string): Promise<boolean>
  /**
   * How many pieces of content carry this term.
   *
   * For the same reason media has a `usages`: a delete that says what it will
   * affect is a delete someone can make a decision about. Deleting a term is not
   * refused -- the assignments go with it -- so this is a warning, not a gate.
   */
  usage(ctx: TenantContext, id: string): Promise<number>
  /** The terms a piece of content carries, vocabulary by vocabulary. */
  forContent(ctx: TenantContext, contentType: ContentType, contentId: string): Promise<Term[]>
  /** Replaces the terms on a piece of content with exactly this set. */
  assign(ctx: TenantContext, contentType: ContentType, contentId: string, termIds: string[]): Promise<void>
}

export interface Repositories {
  sites: SiteRepository
  pages: PageRepository
  posts: PostRepository
  products: ProductRepository
  media: MediaRepository
  themeTemplates: ThemeTemplateRepository
  vocabularies: VocabularyRepository
  terms: TermRepository
}
