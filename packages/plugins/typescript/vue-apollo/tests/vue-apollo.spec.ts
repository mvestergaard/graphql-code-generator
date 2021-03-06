import { compileTs, validateTs } from '@graphql-codegen/testing';
import { plugin, VueApolloRawPluginConfig } from '../src/index';
import { parse, GraphQLSchema, buildClientSchema } from 'graphql';
import gql from 'graphql-tag';
import { Types, mergeOutputs } from '@graphql-codegen/plugin-helpers';
import { plugin as tsPlugin } from '../../typescript/src/index';
import { plugin as tsDocumentsPlugin } from '../../operations/src/index';
import { readFileSync } from 'fs';
import { DocumentMode } from '@graphql-codegen/visitor-plugin-common';
import { extract } from 'jest-docblock';

describe('Vue Apollo', () => {
  const schema = buildClientSchema(JSON.parse(readFileSync('../../../../dev-test/githunt/schema.json').toString()));
  const basicDoc = parse(/* GraphQL */ `
    query test {
      feed {
        id
        commentCount
        repository {
          full_name
          html_url
          owner {
            avatar_url
          }
        }
      }
    }
  `);
  const mutationDoc = parse(/* GraphQL */ `
    mutation test($name: String) {
      submitRepository(repoFullName: $name) {
        id
      }
    }
  `);

  const subscriptionDoc = parse(/* GraphQL */ `
    subscription test($name: String) {
      commentAdded(repoFullName: $name) {
        id
      }
    }
  `);

  const validateTypeScript = async (output: Types.PluginOutput, testSchema: GraphQLSchema, documents: Types.DocumentFile[], config: any, playground = false) => {
    const tsOutput = await tsPlugin(testSchema, documents, config, { outputFile: '' });
    const tsDocumentsOutput = await tsDocumentsPlugin(testSchema, documents, config, { outputFile: '' });
    const merged = mergeOutputs([tsOutput, tsDocumentsOutput, output]);
    validateTs(merged, undefined, true, false, playground);

    return merged;
  };

  const validateAndCompile = async (content: Types.PluginOutput, config: any = {}, pluginSchema: GraphQLSchema, documents: Types.DocumentFile[], usage = '', playground = false) => {
    const tsOutput = await tsPlugin(pluginSchema, documents, config, { outputFile: '' });
    const tsDocumentsOutput = await tsDocumentsPlugin(pluginSchema, documents, config, { outputFile: '' });
    const merged = mergeOutputs([tsOutput, tsDocumentsOutput, content]);

    await compileTs(merged, {}, true, playground);

    return merged;
  };

  describe('Imports', () => {
    it('should import VueApollo and VueCompositionApi dependencies', async () => {
      const docs = [{ location: '', document: basicDoc }];
      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as VueApolloComposable from '@vue/apollo-composable';`);
      expect(content.prepend).toContain(`import * as VueCompositionApi from '@vue/composition-api';`);
      expect(content.prepend).toContain(`import gql from 'graphql-tag';`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should import DocumentNode when using noGraphQLTag', async () => {
      const docs = [{ location: '', document: basicDoc }];
      const content = (await plugin(
        schema,
        docs,
        {
          noGraphQLTag: true,
        },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import { DocumentNode } from 'graphql';`);
      expect(content.prepend).not.toContain(`import gql from 'graphql-tag';`);
      await validateTypeScript(content, schema, docs, {});
    });

    it(`should use gql import from gqlImport config option`, async () => {
      const docs = [{ location: '', document: basicDoc }];
      const content = (await plugin(
        schema,
        docs,
        { gqlImport: 'graphql.macro#gql' },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import { gql } from 'graphql.macro';`);
      await validateTypeScript(content, schema, docs, {});
    });

    it(`tests for dedupeOperationSuffix`, async () => {
      const ast = parse(/* GraphQL */ `
        query notificationsQuery {
          notifications {
            id
          }
        }
      `);
      const ast2 = parse(/* GraphQL */ `
        query notifications {
          notifications {
            id
          }
        }
      `);

      expect(((await plugin(schema, [{ location: 'test-file.ts', document: ast }], {}, { outputFile: '' })) as any).content).toContain('ReturnType<typeof useNotificationsQueryQuery>;');
      expect(((await plugin(schema, [{ location: 'test-file.ts', document: ast }], { dedupeOperationSuffix: false }, { outputFile: '' })) as any).content).toContain('ReturnType<typeof useNotificationsQueryQuery>;');
      expect(((await plugin(schema, [{ location: 'test-file.ts', document: ast }], { dedupeOperationSuffix: true }, { outputFile: '' })) as any).content).toContain('ReturnType<typeof useNotificationsQuery>;');
      expect(((await plugin(schema, [{ location: 'test-file.ts', document: ast2 }], { dedupeOperationSuffix: true }, { outputFile: '' })) as any).content).toContain('ReturnType<typeof useNotificationsQuery>;');
      expect(((await plugin(schema, [{ location: 'test-file.ts', document: ast2 }], { dedupeOperationSuffix: false }, { outputFile: '' })) as any).content).toContain('ReturnType<typeof useNotificationsQuery>;');
    });

    it('should import VueApolloComposable from VueApolloComposableImportFrom config option', async () => {
      const docs = [{ location: '', document: basicDoc }];
      const content = (await plugin(
        schema,
        docs,
        { vueApolloComposableImportFrom: 'vue-apollo-composition-functions' },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as VueApolloComposable from 'vue-apollo-composition-functions';`);
      await validateTypeScript(content, schema, docs, {});
    });
  });

  describe('Fragments', () => {
    it('Should generate basic fragments documents correctly', async () => {
      const docs = [
        {
          location: 'a.graphql',
          document: parse(/* GraphQL */ `
            fragment MyFragment on Repository {
              full_name
            }

            query {
              feed {
                id
              }
            }
          `),
        },
      ];
      const result = (await plugin(schema, docs, {}, { outputFile: '' })) as Types.ComplexPluginOutput;

      expect(result.content).toBeSimilarStringTo(`
      export const MyFragmentFragmentDoc = gql\`
      fragment MyFragment on Repository {
        full_name
      }
      \`;`);
      await validateTypeScript(result, schema, docs, {});
    });

    it('should generate Document variables for inline fragments', async () => {
      const repositoryWithOwner = gql`
        fragment RepositoryWithOwner on Repository {
          full_name
          html_url
          owner {
            avatar_url
          }
        }
      `;
      const feedWithRepository = gql`
        fragment FeedWithRepository on Entry {
          id
          commentCount
          repository(search: "phrase") {
            ...RepositoryWithOwner
          }
        }

        ${repositoryWithOwner}
      `;
      const myFeed = gql`
        query MyFeed {
          feed {
            ...FeedWithRepository
          }
        }

        ${feedWithRepository}
      `;

      const docs = [{ location: '', document: myFeed }];

      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).toBeSimilarStringTo(`export const FeedWithRepositoryFragmentDoc = gql\`
fragment FeedWithRepository on Entry {
  id
  commentCount
  repository(search: "phrase") {
    ...RepositoryWithOwner
  }
}
\${RepositoryWithOwnerFragmentDoc}\`;`);
      expect(content.content).toBeSimilarStringTo(`export const RepositoryWithOwnerFragmentDoc = gql\`
fragment RepositoryWithOwner on Repository {
  full_name
  html_url
  owner {
    avatar_url
  }
}
\`;`);

      expect(content.content).toBeSimilarStringTo(`export const MyFeedDocument = gql\`
query MyFeed {
  feed {
    ...FeedWithRepository
  }
}
\${FeedWithRepositoryFragmentDoc}\`;`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should avoid generating duplicate fragments', async () => {
      const simpleFeed = gql`
        fragment Item on Entry {
          id
        }
      `;
      const myFeed = gql`
        query MyFeed {
          feed {
            ...Item
          }
          allFeeds: feed {
            ...Item
          }
        }
      `;
      const documents = [simpleFeed, myFeed];
      const docs = documents.map(document => ({ document, location: '' }));
      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).toBeSimilarStringTo(`
        export const MyFeedDocument = gql\`
        query MyFeed {
            feed {
              ...Item
            }
            allFeeds: feed {
              ...Item
            }
          }
          \${ItemFragmentDoc}\``);
      expect(content.content).toBeSimilarStringTo(`
        export const ItemFragmentDoc = gql\`
        fragment Item on Entry {
          id
        }
\`;`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('Should generate fragments in proper order (when one depends on other)', async () => {
      const myFeed = gql`
        fragment FeedWithRepository on Entry {
          id
          repository {
            ...RepositoryWithOwner
          }
        }

        fragment RepositoryWithOwner on Repository {
          full_name
        }

        query MyFeed {
          feed {
            ...FeedWithRepository
          }
        }
      `;
      const documents = [myFeed];
      const docs = documents.map(document => ({ document, location: '' }));
      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      const feedWithRepositoryPos = content.content.indexOf('fragment FeedWithRepository');
      const repositoryWithOwnerPos = content.content.indexOf('fragment RepositoryWithOwner');
      expect(repositoryWithOwnerPos).toBeLessThan(feedWithRepositoryPos);
      await validateTypeScript(content, schema, docs, {});
    });
  });

  describe('Composition functions', () => {
    it('Should generate composition functions for query and mutation', async () => {
      const documents = parse(/* GraphQL */ `
        query feed {
          feed {
            id
            commentCount
            repository {
              full_name
              html_url
              owner {
                avatar_url
              }
            }
          }
        }

        mutation submitRepository($name: String) {
          submitRepository(repoFullName: $name) {
            id
          }
        }
      `);
      const docs = [{ location: '', document: documents }];

      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;
      expect(content.content).toBeSimilarStringTo(`type ReactiveFunctionFeedQuery = () => FeedQueryVariables \n
export function useFeedQuery(variables?: FeedQueryVariables | VueCompositionApi.Ref<FeedQueryVariables> | ReactiveFunctionFeedQuery, baseOptions?: VueApolloComposable.UseQueryOptions<FeedQuery, FeedQueryVariables>) {
  return VueApolloComposable.useQuery<FeedQuery, FeedQueryVariables>(FeedDocument, variables, baseOptions);
}`);

      expect(content.content).toBeSimilarStringTo(`
export function useSubmitRepositoryMutation(baseOptions?: VueApolloComposable.UseMutationOptions<SubmitRepositoryMutation, SubmitRepositoryMutationVariables>) {
  return VueApolloComposable.useMutation<SubmitRepositoryMutation, SubmitRepositoryMutationVariables>(SubmitRepositoryDocument, baseOptions);
}`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('Should generate deduped composition functions for query and mutation', async () => {
      const documents = parse(/* GraphQL */ `
        query FeedQuery {
          feed {
            id
            commentCount
            repository {
              full_name
              html_url
              owner {
                avatar_url
              }
            }
          }
        }

        mutation SubmitRepositoryMutation($name: String) {
          submitRepository(repoFullName: $name) {
            id
          }
        }
      `);
      const docs = [{ location: '', document: documents }];

      const content = (await plugin(
        schema,
        docs,
        { dedupeOperationSuffix: true },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).toBeSimilarStringTo(`
export function useFeedQuery(variables?: FeedQueryVariables | VueCompositionApi.Ref<FeedQueryVariables> | ReactiveFunctionFeedQuery, baseOptions?: VueApolloComposable.UseQueryOptions<FeedQuery, FeedQueryVariables>) {
  return VueApolloComposable.useQuery<FeedQuery, FeedQueryVariables>(FeedQueryDocument, variables, baseOptions);
}`);

      expect(content.content).toBeSimilarStringTo(`
export function useSubmitRepositoryMutation(baseOptions?: VueApolloComposable.UseMutationOptions<SubmitRepositoryMutation, SubmitRepositoryMutationVariables>) {
  return VueApolloComposable.useMutation<SubmitRepositoryMutation, SubmitRepositoryMutationVariables>(SubmitRepositoryMutationDocument, baseOptions);
}`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('Should not generate composition functions for query and mutation', async () => {
      const docs = [{ location: '', document: basicDoc }];
      const content = (await plugin(
        schema,
        docs,
        { withCompositionFunctions: false },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).not.toContain(`export function useTestQuery`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('Should generate subscription composition functions', async () => {
      const documents = parse(/* GraphQL */ `
        subscription ListenToComments($name: String) {
          commentAdded(repoFullName: $name) {
            id
          }
        }
      `);

      const docs = [{ location: '', document: documents }];

      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).toBeSimilarStringTo(`
export function useListenToCommentsSubscription(variables?: ListenToCommentsSubscriptionVariables, baseOptions?: VueApolloComposable.UseSubscriptionOptions<ListenToCommentsSubscription, ListenToCommentsSubscriptionVariables>) {
  return VueApolloComposable.useSubscription<ListenToCommentsSubscription, ListenToCommentsSubscriptionVariables>(ListenToCommentsDocument, variables, baseOptions);
}`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('Should not add typesPrefix to composition functions', async () => {
      const docs = [{ location: '', document: basicDoc }];
      const content = (await plugin(
        schema,
        docs,
        { typesPrefix: 'I' },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).toContain(`export function useTestQuery`);
    });

    it('should generate composition function result', async () => {
      const documents = parse(/* GraphQL */ `
        query feed {
          feed {
            id
            commentCount
            repository {
              full_name
              html_url
              owner {
                avatar_url
              }
            }
          }
        }

        mutation submitRepository($name: String) {
          submitRepository(repoFullName: $name) {
            id
          }
        }
      `);
      const docs = [{ location: '', document: documents }];

      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).toBeSimilarStringTo(`
      export type FeedQueryCompositionFunctionResult = ReturnType<typeof useFeedQuery>;
      `);

      expect(content.content).toBeSimilarStringTo(`
      export type SubmitRepositoryMutationCompositionFunctionResult = ReturnType<typeof useSubmitRepositoryMutation>;
      `);
      await validateTypeScript(content, schema, docs, {});
    });

    it('Should generate required variables if required in graphql document', async () => {
      const documents = parse(/* GraphQL */ `
        query feed($id: ID!, $name: String, $people: [String]!) {
          feed(id: $id) {
            id
          }
        }
        mutation submitRepository($name: String!) {
          submitRepository(repoFullName: $name) {
            id
          }
        }

        subscription test($name: String!) {
          commentAdded(repoFullName: $name) {
            id
          }
        }
      `);
      const docs = [{ location: '', document: documents }];

      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      // query with required variables
      expect(content.content).toBeSimilarStringTo(`
      export function useFeedQuery(variables: FeedQueryVariables | VueCompositionApi.Ref<FeedQueryVariables> | ReactiveFunctionFeedQuery, baseOptions?: VueApolloComposable.UseQueryOptions<FeedQuery, FeedQueryVariables>) {
        return VueApolloComposable.useQuery<FeedQuery, FeedQueryVariables>(FeedDocument, variables, baseOptions);
      }`);

      // mutation with required variables
      expect(content.content).toBeSimilarStringTo(`
      export function useSubmitRepositoryMutation(baseOptions?: VueApolloComposable.UseMutationOptions<SubmitRepositoryMutation, SubmitRepositoryMutationVariables>) {
        return VueApolloComposable.useMutation<SubmitRepositoryMutation, SubmitRepositoryMutationVariables>(SubmitRepositoryDocument, baseOptions);
      }`);

      // subscription with required variables
      expect(content.content).toBeSimilarStringTo(`
      export function useTestSubscription(variables: TestSubscriptionVariables, baseOptions?: VueApolloComposable.UseSubscriptionOptions<TestSubscription, TestSubscriptionVariables>) {
        return VueApolloComposable.useSubscription<TestSubscription, TestSubscriptionVariables>(TestDocument, variables, baseOptions);
      }`);

      await validateTypeScript(content, schema, docs, {});
    });

    const queryDocBlockSnapshot = `/**
 * __useFeedQuery__
 *
 * To run a query within a Vue component, call \`useFeedQuery\` and pass it any options that fit your needs.
 * When your component renders, \`useFeedQuery\` returns an object from Apollo Client that contains result, loading and error properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/query.html#options;
 *
 * @example
 * const { result, loading, error } = useFeedQuery(
 *   {
 *      id: // value for 'id'
 *   }
 * );
 */`;

    const mutationDocBlockSnapshot = `/**
 * __useSubmitRepositoryMutation__
 *
 * To run a mutation, you first call \`useSubmitRepositoryMutation\` within a Vue component and pass it any options that fit your needs.
 * When your component renders, \`useSubmitRepositoryMutation\` returns an object that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - Several other properties: https://v4.apollo.vuejs.org/api/use-mutation.html#return
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://v4.apollo.vuejs.org/guide-composable/mutation.html#options;
 *
 * @example
 * const { mutate, loading, error, onDone } = useSubmitRepositoryMutation({
 *   variables: {
 *      name: // value for 'name'
 *   },
 * });
 */`;

    it('Should generate JSDoc docblocks for composition functions', async () => {
      const documents = parse(/* GraphQL */ `
        query feed($id: ID!) {
          feed(id: $id) {
            id
          }
        }
        mutation submitRepository($name: String) {
          submitRepository(repoFullName: $name) {
            id
          }
        }
      `);

      const docs = [{ location: '', document: documents }];

      const content = (await plugin(
        schema,
        docs,
        {},
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      const queryDocBlock = extract(content.content.substr(content.content.indexOf('/**')));

      expect(queryDocBlock).toEqual(queryDocBlockSnapshot);

      const mutationDocBlock = extract(content.content.substr(content.content.lastIndexOf('/**')));

      expect(mutationDocBlock).toEqual(mutationDocBlockSnapshot);
    });

    it('Should NOT generate JSDoc docblocks for composition functions if addDocBlocks is false', async () => {
      const documents = parse(/* GraphQL */ `
        query feed($id: ID!) {
          feed(id: $id) {
            id
          }
        }
        mutation submitRepository($name: String) {
          submitRepository(repoFullName: $name) {
            id
          }
        }
      `);

      const docs = [{ location: '', document: documents }];

      const content = (await plugin(
        schema,
        docs,
        { addDocBlocks: false },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      const queryDocBlock = extract(content.content.substr(content.content.indexOf('/**')));

      expect(queryDocBlock).not.toEqual(queryDocBlockSnapshot);

      const mutationDocBlock = extract(content.content.substr(content.content.lastIndexOf('/**')));

      expect(mutationDocBlock).not.toEqual(mutationDocBlockSnapshot);
    });
  });

  describe('documentMode and importDocumentNodeExternallyFrom', () => {
    const multipleOperationDoc = parse(/* GraphQL */ `
      query testOne {
        feed {
          id
          commentCount
          repository {
            full_name
            html_url
            owner {
              avatar_url
            }
          }
        }
      }

      mutation testTwo($name: String) {
        submitRepository(repoFullName: $name) {
          id
        }
      }

      subscription testThree($name: String) {
        commentAdded(repoFullName: $name) {
          id
        }
      }
    `);

    it('should import DocumentNode when documentMode is "documentNode"', async () => {
      const docs = [{ location: '', document: basicDoc }];
      const content = (await plugin(
        schema,
        docs,
        {
          documentMode: DocumentMode.documentNode,
        },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import { DocumentNode } from 'graphql';`);
      expect(content.prepend).not.toContain(`import gql from 'graphql-tag';`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should generate Document variable when documentMode is "documentNode"', async () => {
      const docs = [{ location: '', document: basicDoc }];
      const content = (await plugin(
        schema,
        docs,
        {
          documentMode: DocumentMode.documentNode,
        },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).toBeSimilarStringTo(`export const TestDocument`);

      // For issue #1599 - make sure there are not `loc` properties
      expect(content.content).not.toContain(`loc":`);
      expect(content.content).not.toContain(`loc':`);

      await validateTypeScript(content, schema, docs, {});
    });

    it('should NOT generate inline fragment docs for external mode: file with operation using inline fragment', async () => {
      const docs = [
        {
          location: '',
          document: parse(/* GraphQL */ `
            fragment feedFragment on Entry {
              id
              commentCount
            }
            query testOne {
              feed {
                ...feedFragment
              }
            }
          `),
        },
      ];
      const config = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'path/to/documents.tsx',
      };
      const content = (await plugin(
        schema,
        docs,
        { ...config },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).not.toBeSimilarStringTo(`export const FeedFragmentFragmentDoc`);

      await validateTypeScript(content, schema, docs, {});
    });

    it('should NOT generate inline fragment docs for external mode: file with operation NOT using inline fragment', async () => {
      const docs = [
        {
          location: '',
          document: parse(/* GraphQL */ `
            fragment feedFragment on Entry {
              id
              commentCount
            }
            query testOne {
              feed {
                id
              }
            }
          `),
        },
      ];
      const config = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'path/to/documents.tsx',
      };
      const content = (await plugin(
        schema,
        docs,
        {
          ...config,
        },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).not.toBeSimilarStringTo(`export const FeedFragmentFragmentDoc`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should NOT generate inline fragment docs for external mode: file with just fragment', async () => {
      const docs = [
        {
          location: '',
          document: parse(/* GraphQL */ `
            fragment feedFragment on Entry {
              id
              commentCount
            }
          `),
        },
      ];
      const config = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'path/to/documents.tsx',
      };
      const content = (await plugin(
        schema,
        docs,
        {
          ...config,
        },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.content).not.toBeSimilarStringTo(`export const FeedFragmentFragmentDoc`);

      await validateTypeScript(content, schema, docs, { ...config });
    });

    it('should import Operations from one external file and use it in useQuery', async () => {
      const config: VueApolloRawPluginConfig = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'path/to/documents',
      };

      const docs = [{ location: '', document: basicDoc }];

      const content = (await plugin(schema, docs, config, {
        outputFile: 'graphql.ts',
      })) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as Operations from 'path/to/documents';`);
      expect(content.content).toBeSimilarStringTo(`export function useTestQuery`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should import Operations from one external file and use it in useMutation', async () => {
      const config: VueApolloRawPluginConfig = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'path/to/documents.ts',
      };

      const docs = [{ location: '', document: mutationDoc }];

      const content = (await plugin(schema, docs, config, {
        outputFile: 'graphql.ts',
      })) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as Operations from 'path/to/documents';`);
      expect(content.content).toBeSimilarStringTo(`export function useTestMutation`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should import Operations from one external file and use it in useSubscription', async () => {
      const config: VueApolloRawPluginConfig = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'path/to/documents.tsx',
      };

      const docs = [{ location: '', document: subscriptionDoc }];

      const content = (await plugin(schema, docs, config, {
        outputFile: 'graphql.ts',
      })) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as Operations from 'path/to/documents';`);
      expect(content.content).toBeSimilarStringTo(`export function useTestSubscription`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should import Operations from one external file and use it in multiple composition functions', async () => {
      const config: VueApolloRawPluginConfig = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'path/to/documents.tsx',
      };

      const docs = [{ location: '', document: multipleOperationDoc }];

      const content = (await plugin(schema, docs, config, {
        outputFile: 'graphql.ts',
      })) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as Operations from 'path/to/documents';`);
      expect(content.content).toBeSimilarStringTo(`export function useTestOneQuery`);
      expect(content.content).toBeSimilarStringTo(`export function useTestTwoMutation`);
      expect(content.content).toBeSimilarStringTo(`export function useTestThreeSubscription`);

      await validateTypeScript(content, schema, docs, {});
    });

    it('should import Operations from near operation file for useQuery', async () => {
      const config: VueApolloRawPluginConfig = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'near-operation-file',
      };

      const docs = [{ location: 'path/to/document.graphql', document: basicDoc }];

      const content = (await plugin(schema, docs, config, {
        outputFile: 'graphql.ts',
      })) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as Operations from './document.graphql';`);
      expect(content.content).toBeSimilarStringTo(`export function useTestQuery`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should import Operations from near operation file for useMutation', async () => {
      const config: VueApolloRawPluginConfig = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'near-operation-file',
      };

      const docs = [{ location: 'path/to/document.graphql', document: mutationDoc }];

      const content = (await plugin(schema, docs, config, {
        outputFile: 'graphql.ts',
      })) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as Operations from './document.graphql';`);
      expect(content.content).toBeSimilarStringTo(`export function useTestMutation`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should import Operations from near operation file for useSubscription', async () => {
      const config: VueApolloRawPluginConfig = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'near-operation-file',
      };

      const docs = [{ location: 'path/to/document.graphql', document: subscriptionDoc }];

      const content = (await plugin(schema, docs, config, {
        outputFile: 'graphql.ts',
      })) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as Operations from './document.graphql';`);
      expect(content.content).toBeSimilarStringTo(`export function useTestSubscription`);
      await validateTypeScript(content, schema, docs, {});
    });

    it('should import Operations from near operation file and use it in multiple composition functions', async () => {
      const config: VueApolloRawPluginConfig = {
        documentMode: DocumentMode.external,
        importDocumentNodeExternallyFrom: 'near-operation-file',
      };

      const docs = [{ location: 'path/to/document.graphql', document: multipleOperationDoc }];

      const content = (await plugin(schema, docs, config, {
        outputFile: 'graphql.ts',
      })) as Types.ComplexPluginOutput;

      expect(content.prepend).toContain(`import * as Operations from './document.graphql';`);
      expect(content.content).toBeSimilarStringTo(`export function useTestOneQuery`);
      expect(content.content).toBeSimilarStringTo(`export function useTestTwoMutation`);
      expect(content.content).toBeSimilarStringTo(`export function useTestThreeSubscription`);

      await validateTypeScript(content, schema, docs, {});
    });

    it(`should NOT import Operations if no operation collected: external mode and one file`, async () => {
      const docs = [
        {
          location: 'path/to/document.graphql',
          document: parse(/* GraphQL */ `
            fragment feedFragment on Entry {
              id
              commentCount
            }
          `),
        },
      ];
      const content = (await plugin(
        schema,
        docs,
        {
          documentMode: DocumentMode.external,
          importDocumentNodeExternallyFrom: 'near-operation-file',
        },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.prepend).not.toBeSimilarStringTo(`import * as Operations`);
      await validateTypeScript(content, schema, docs, {});
    });

    it(`should NOT import Operations if no operation collected: external mode and multiple files`, async () => {
      const docs = [
        {
          location: 'a.graphql',
          document: parse(/* GraphQL */ `
            fragment feedFragment1 on Entry {
              id
              commentCount
            }
          `),
        },
        {
          location: 'b.graphql',
          document: parse(/* GraphQL */ `
            fragment feedFragment2 on Entry {
              id
              commentCount
            }
          `),
        },
      ];
      const content = (await plugin(
        schema,
        docs,
        {
          documentMode: DocumentMode.external,
          importDocumentNodeExternallyFrom: 'path/to/documents.tsx',
        },
        {
          outputFile: 'graphql.ts',
        }
      )) as Types.ComplexPluginOutput;

      expect(content.prepend).not.toBeSimilarStringTo(`import * as Operations`);
      await validateTypeScript(content, schema, docs, {});
    });
  });
});
