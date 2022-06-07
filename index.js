const { Client: NotionClient } = require('@notionhq/client')
const camelCase = require('just-camel-case')

const log = (...params) => {
  console.log(...params)
}

async function getBlocks({ id, authToken }) {
  const notionClient = new NotionClient({ auth: authToken })

  let hasMore = true
  let startCursor
  let blockContent = []

  while (hasMore) {
    try {
      const response = await notionClient.blocks.children.list({
        block_id: id,
        page_size: 100,
        start_cursor: startCursor,
      })

      for (let childBlock of response.results) {
        if (childBlock.has_children) {
          childBlock.children = await getBlocks({
            id: childBlock.id,
            authToken,
          })
        }
      }

      blockContent = blockContent.concat(response.results)
      startCursor = response.next_cursor
      hasMore = response.has_more
    } catch (error) {
      console.error(error.message)
    }
  }

  return blockContent
}

async function getPages({ authToken, databaseId }) {
  const notionClient = new NotionClient({ auth: authToken })

  let hasMore = true
  let startCursor
  const pages = []

  while (hasMore) {
    try {
      const response = await notionClient.databases.query({
        database_id: databaseId,
        page_size: 100,
        start_cursor: startCursor,
      })

      startCursor = response.next_cursor
      hasMore = response.has_more

      for (const page of response.results) {
        page.children = await getBlocks({ id: page.id, authToken })

        pages.push(page)
      }
    } catch (error) {
      console.error(error.message)
    }
  }

  return pages
}

function getRenderer(type, renderers, fallback) {
  const noRenderer = (block) => log(`No renderer found for ${block}`)
  if (!type || !renderers) {
    return fallback ?? noRenderer
  }

  const renderer = renderers[type] ?? renderers[camelCase(type)]
  const fallbackRenderer = fallback ?? renderers.default ?? noRenderer
  return renderer ? renderer.bind(renderers) : fallbackRenderer
}

const defaultRenderers = {
  async richText(block) {
    const richTextType = block.rich_text?.length
      ? 'rich_text'
      : block.caption?.length
      ? 'caption'
      : block?.length
      ? 'list'
      : null

    if (!richTextType) {
      log('Unable to determine richTextType')
      return null
    }

    const content = await Promise.all(
      (block[richTextType] ?? block).map(async (textBlock) => {
        const { type } = textBlock
        // const renderer = (
        //   this[type] ??
        //   this[camelCase(type)] ??
        //   this.default
        // ).bind(this)
        const renderer = getRenderer(type, this)
        const rendererName = renderer.name.replace('bound', '').trim()
        log(`Richtext ${type} - ${rendererName}`)
        const renderedTextBlock = await renderer(textBlock, type)
        return renderedTextBlock
      })
    )
    return content.join('')
  },
  async text(block) {
    log('text')
    const { bold, italic, strikethrough, underline, code, color } =
      block.annotations

    /** {string} */
    const originalContent = block.text.content
    const trimmedContent = originalContent.trim()
    let content = trimmedContent

    bold && this.bold && (content = this.bold(content))
    italic && this.italic && (content = this.italic(content))
    strikethrough &&
      this.strikethrough &&
      (content = this.strikethrough(content))
    underline && this.underline && (content = this.underline(content))
    code && this.inlineCode && (content = this.inlineCode(content))
    color !== 'default' && this.color && (content = this.color(content, color))

    content = originalContent.replace(trimmedContent, content)
    return content
  },
  async mention(block) {
    log('mention')
    const mentionBlock = block.mention
    const { type } = mentionBlock
    // const renderer = (this[type] ?? this[camelCase(type)] ?? this.default).bind(
    //   this
    // )
    const renderer = getRenderer(type, this)
    const renderedBlock = await renderer(mentionBlock, type)
    return renderedBlock
  },
  async page(block) {
    log('page')
    return `page - ${block.page.id}`
  },
  async date(block) {
    log('date')
    return `${block.date.start}${block.date.end ? ` - ${block.date.end}` : ''}`
  },
  bold: (content) => `**${content}**`,
  italic: (content) => `*${content}*`,
  strikethrough: (content) => `~~${content}~~`,
  underline: (content) => `<u>${content}</u>`,
  inlineCode: (content) => `\`${content}\``,
  color: (content, color) => {
    const [colorCode, background] = color.split('_')
    const style = background
      ? `background: ${colorCode}`
      : `color: ${colorCode}`
    return `<span data-color="${color}" style="${style}">${content}</span>`
  },
  async paragraph(block, content) {
    log('paragraph')
    return `${content}\n`
  },
  async heading1(block, content) {
    log('heading_1')
    return `# ${content}\n`
  },
  async heading2(block, content) {
    log('heading_2')
    return `## ${content}\n`
  },
  async heading3(block, content) {
    log('heading_3')
    return `### ${content}\n`
  },
  async toDoList(children) {
    log('to_do_list', children)
    return `${children.join('\n')}\n`
  },
  async toDo(block, content) {
    const { checked } = block
    log('to_do')
    return `- [${checked ? 'x' : ' '}] ${content}`
  },
  async bulletedList(children) {
    log('bulleted_list', children)
    return `${children.join('\n')}\n`
  },
  async bulletedListItem(block, content) {
    log('bulleted_list_item', content)
    return `- ${content}`
  },
  async numberedList(children) {
    log('numbered_list', children)
    return `${children.join('\n')}\n`
  },
  async numberedListItem(block, content) {
    log('numbered_list_item')
    return `1. ${content}`
  },
  async toggle(block, content, children) {
    log('toggle')
    return `<details>\n<summary>${content}</summary>\n${children.join(
      '\n'
    )}</details>\n`
  },
  async quote(block, content) {
    log('quote')
    return `> ${content}\n`
  },
  async divider(block) {
    log('divider')
    return `---\n`
  },
  async table(block, content, children) {
    const { table_width, has_column_header } = block
    log('table')
    const [firstRow, ...otherRows] = children
    return `${firstRow}\n| ${new Array(table_width)
      .fill('---')
      .join(' | ')} |\n${otherRows.map((row) => row).join('\n')}\n`
  },
  async tableRow(block) {
    log('table_row')
    const cells = await Promise.all(
      block.cells.map(async (cell) => {
        const renderedCell = await this.richText(cell)
        return renderedCell
      })
    )
    return `| ${cells.join(' | ')} |`
  },
  async callout(block, content) {
    log('callout')
    return `<div data-callout="${block.icon.emoji}">${content}</div>\n`
  },
  async linkToPage(block) {
    log('link_to_page')
    return `[${block.page_id}](${block.page_id})\n`
  },
  async image(block, content) {
    log('image')
    const { type } = block
    const { url } = block[type]
    return `<img src="${url}" alt="${content}" />\n`
  },
  async video(block, content) {
    log('video')
    const { type } = block
    let { url } = block[type]

    if (/youtu\.be/i.test(url)) {
      url = url.replace('youtu.be', 'www.youtube.com/embed')
      return `<iframe width="560" height="315" src="${url}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>\n`
    } else if (/youtube.com\/watch/i.test(url)) {
      url = url.replace('watch?v=', 'embed/')
      return `<iframe width="560" height="315" src="${url}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>\n`
    }
    return `<!-- Video - ${url} -->\n`
  },
  async bookmark(block, content) {
    log('bookmark')
    return `[${content}](${block.url})\n`
  },
  async code(block, content) {
    log('code')
    return `\`\`\`${block.language}\n${content}\n\`\`\``
  },
  async embed(block, content) {
    log('embed')
    return `[${content}](${block.url})\n`
  },
  async default(block, content) {
    log('default -')
    log(JSON.stringify(block, null, 2))
    return `<!-- Default block -->\n`
  },
  async unsupported() {
    log('unsupported')
    return `<!-- Unsupported block -->\n`
  },
}

const listTypes = ['bulleted_list_item', 'numbered_list_item', 'to_do']
const listTypeToRenderer = {
  bulleted_list_item: 'bulleted_list',
  numbered_list_item: 'numbered_list',
  to_do: 'to_do_list',
}

async function renderNotionPageProperties(page, renderers = defaultRenderers) {
  const properties = {
    ...page.properties,
    cover: page.cover,
    icon: page.icon,
  }
  const renderedProperties = {}

  for (const [key, property] of Object.entries(properties)) {
    const type = property?.type ?? ''
    // const renderer = (
    //   renderers[key] ??
    //   renderers[camelCase(key)] ??
    //   renderers[type] ??
    //   renderers[camelCase(type)] ??
    //   renderers.default
    // ).bind(renderers)
    const keyRenderer = getRenderer(key, renderers, false)
    const typeRenderer = getRenderer(type, renderers)
    const renderer = keyRenderer || typeRenderer
    const rendererName = renderer.name.replace('bound', '').trim()
    log(`\nRendering - ${key} - ${type} - ${rendererName}`)

    const renderedProperty = await renderer(property?.[type], page.id)
    renderedProperties[camelCase(key)] = renderedProperty
  }
  return renderedProperties
}

async function renderNotionBlocks(blocks, renderers = defaultRenderers) {
  let index = 0
  const renderedBlocks = []

  while (index < blocks.length) {
    let block = blocks[index]
    let { type, has_children } = block

    // let renderer = (
    //   renderers[type] ??
    //   renderers[camelCase(type)] ??
    //   renderers.default
    // ).bind(renderers)
    const renderer = getRenderer(type, renderers)
    const rendererName = renderer.name.replace('bound', '').trim()
    log(
      `\nRendering ${index + 1} of ${blocks.length} - ${type} - ${rendererName}`
    )
    // const richTextRenderer = (
    //   renderers.rich_text ??
    //   renderers.richText ??
    //   renderers.default
    // ).bind(renderers)
    const richTextRenderer = getRenderer('rich_text', renderers)

    if (!listTypes.includes(type)) {
      const content = await richTextRenderer(block[type])
      log(`Content - ${content}`)
      let children
      if (has_children) {
        children = await renderNotionBlocks(block.children, renderers)
      }

      const renderedBlock = await renderer(
        block[type],
        content ?? '',
        children ?? [],
        block.id
      )
      renderedBlocks.push(renderedBlock)
      index += 1
    } else {
      const listType = listTypeToRenderer[type]
      // const listRenderer = (
      //   renderers[listType] ??
      //   renderers[camelCase(listType)] ??
      //   renderers.default
      // ).bind(renderers)
      const listRenderer = getRenderer(listType, renderers)
      const children = []

      while (index < blocks.length && blocks[index].type === type) {
        const content = await richTextRenderer(block[type])
        const renderedListItem = await renderer(block[type], content ?? '')
        children.push(renderedListItem)

        index += 1
        block = blocks[index]
      }

      const renderedBlock = await listRenderer(children)
      renderedBlocks.push(renderedBlock)
    }
  }

  return renderedBlocks
}

module.exports = {
  defaultRenderers,
  getBlocks,
  getPages,
  renderNotionBlocks,
  renderNotionPageProperties,
}
